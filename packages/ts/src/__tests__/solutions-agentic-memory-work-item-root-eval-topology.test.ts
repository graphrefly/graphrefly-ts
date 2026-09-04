import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
} from "../../evals/graph-native-rerun-avoidance/canonical.js";
import { createCurrentExactModelHarnessProfileInput } from "../../evals/graph-native-rerun-avoidance/current-exact-profile.js";
import {
	admitRootEvalOccurrence,
	assertRootEvalObservationRuntimeShape,
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
	type EvalProviderCapacityState,
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
	ROOT_EVAL_REPLICATE_COUNT,
	ROOT_EVAL_TOPOLOGY_REVISION,
	rootEvalMaximumObservationOccurrences,
	rootEvalMaximumProviderAttempts,
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
	measureReleaseInvariantPackageManifest,
} from "../../evals/graph-native-rerun-avoidance/implementation-manifest.js";
import {
	rootEvalPrecredentialStagePlan,
	runRootEvalPrecredentialStagePlan,
} from "../../evals/graph-native-rerun-avoidance/precredential-stage-coordinator.js";
import {
	nonbillableCostEvidence,
	nonbillableHttpResultDigest,
	ROOT_EVAL_NONBILLABLE_POLICY,
} from "../../evals/graph-native-rerun-avoidance/provider-cost-evidence.js";
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
	rootEvalTaskBindings,
	rootEvalToolCandidateCatalog,
} from "../../evals/graph-native-rerun-avoidance/root-eval-task.js";
import {
	ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT,
	ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT_DIGEST,
	ROOT_EVAL_TOPOLOGY_QUALIFICATION,
} from "../../evals/graph-native-rerun-avoidance/root-eval-topology-qualification.js";
import type { DescribeSnapshot } from "../graph/describe.js";
import type { Node } from "../node/node.js";

const createTopology = (
	options: Omit<Parameters<typeof createRootEvalTopology>[0], "profileInput"> = {},
) =>
	createRootEvalTopology({
		profileInput: createCurrentExactModelHarnessProfileInput(),
		currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
		providerPacingSetTimeout: (callback) => {
			callback();
			return 0 as unknown as ReturnType<typeof setTimeout>;
		},
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
					dispatchOrdinal: effect.dispatchOrdinal,
				});
	const evidence: EvalEffectOutcome["evidence"] = Object.freeze({
		expectedDigest,
		actualDigest: empiricalStrictJsonDigest({
			kind: "actual-control-result",
			replicate: effect.replicate,
			arm: effect.arm,
		}),
		diff: "scoped-change",
		cleanupCompleted: true,
		publicSemantic: "equivalent",
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
		providerLogicalAttempt: effect.providerLogicalAttempt,
		dispatchOrdinal: effect.dispatchOrdinal,
		capacityRetryOrdinal: effect.capacityRetryOrdinal,
		availabilityRetryOrdinal: effect.availabilityRetryOrdinal,
		status: "completed",
		costMicrousd: 0,
		elapsedMs: effect.replicate * 10 + effect.dispatchOrdinal,
		resultDigest: empiricalStrictJsonDigest({
			kind: "no-network-eval-result",
			replicate: effect.replicate,
			arm: effect.arm,
			dispatchOrdinal: effect.dispatchOrdinal,
		}),
		evidence,
		...patch,
	});
}

function providerOutcome(
	effect: EvalAdmittedEffect,
	patch: Partial<EvalProviderOutcome> = {},
): EvalProviderOutcome {
	const recoveryClass =
		patch.reason === "http-capacity-retryable" || patch.reason === "http-capacity-exhausted"
			? ("capacity" as const)
			: patch.reason === "http-availability-retryable" ||
					patch.reason === "http-availability-exhausted" ||
					patch.reason === "transport-availability-retryable" ||
					patch.reason === "transport-availability-exhausted"
				? ("availability" as const)
				: null;
	const providerResponseKind =
		patch.providerResponseKind ??
		(patch.reason === "transport-availability-retryable" ||
		patch.reason === "transport-availability-exhausted"
			? ("transport" as const)
			: patch.reason === "executor-failed" && patch.dispatchAttempted === false
				? ("none" as const)
				: ("http" as const));
	const httpStatus =
		patch.httpStatus ??
		(providerResponseKind === "http"
			? patch.reason === "http-capacity-retryable" || patch.reason === "http-capacity-exhausted"
				? 429
				: patch.reason === "http-availability-retryable" ||
						patch.reason === "http-availability-exhausted"
					? 503
					: 200
			: null);
	const task = ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!;
	const catalog = rootEvalToolCandidateCatalog(task, effect.workItemRole, effect.workItemId);
	const verifiedReplacement =
		effect.workItemRole === "source" ? task.sourceFixtureCorrectText : task.fixtureCorrectText;
	const selected = catalog.candidates.find(
		(candidate) => candidate.replacementDigest === empiricalStrictJsonDigest(verifiedReplacement),
	)!;
	const tool = Object.freeze({
		toolRef: "graphrefly.eval.exact-candidate-tool.v2" as const,
		candidateRef: selected.candidateRef,
		candidateCatalogDigest: catalog.catalogDigest,
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
		providerLogicalAttempt: effect.providerLogicalAttempt,
		dispatchOrdinal: effect.dispatchOrdinal,
		capacityRetryOrdinal: effect.capacityRetryOrdinal,
		availabilityRetryOrdinal: effect.availabilityRetryOrdinal,
		status: "tool-proposed" as const,
		reason: "tool-proposed" as const,
		recoveryClass,
		dispatchAttempted: true,
		dispatchElapsedMs: 0,
		providerResponseKind,
		httpStatus,
		providerErrorCode: null,
		transportNoToolSideEffect: providerResponseKind === "transport",
		costMicrousd: 10,
		costEvidence: "provider-reported" as const,
		pricingRoundingAllowanceMicrousd: 0,
		elapsedMs: effect.replicate * 10 + effect.dispatchOrdinal,
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
	it("keeps Eval lifecycle flags factory-owned and ordinary no-output settlement implicit", () => {
		const source = readFileSync(
			new URL("../../evals/graph-native-rerun-avoidance/eval-topology.ts", import.meta.url),
			"utf8",
		);
		expect(source).not.toMatch(/\bpartial\s*:\s*true/u);
		const reviewedTimer = source.slice(
			source.indexOf("const elapsedBudgetTimerSource"),
			source.indexOf("const elapsedClockPullId"),
		);
		expect((source.match(/\[\["RESOLVED"\]\]/gu) ?? []).length).toBe(3);
		expect((reviewedTimer.match(/\[\["RESOLVED"\]\]/gu) ?? []).length).toBe(3);
	});
	it("preserves every authored observation contribution at the full 175-call 140-retry bound", async () => {
		const topology = createTopology();
		type Contribution = { source: string; revision: number; digest: string; value: unknown };
		const authored = new Map<string, string>();
		const released = new Map<string, string>();
		const arrivals = new Map<string, string>();
		const counts: Record<string, number> = {};
		const record = (path: string, payload: unknown) => {
			const map =
				path === "eval/observation/arrivals"
					? arrivals
					: /^eval\/observation\/input\/[^/]+\/released$/u.test(path)
						? released
						: /^eval\/observation\/input\/[^/]+$/u.test(path)
							? authored
							: null;
			if (map === null) return;
			for (const value of payload as readonly Contribution[]) {
				expect(value.digest).toBe(empiricalStrictJsonDigest(value.value));
				const id = `${value.source}:${value.revision}`;
				if (map.has(id)) expect(map.get(id)).toBe(value.digest);
				map.set(id, value.digest);
			}
		};
		// observe() is live egress, not history replay. Immutable configuration
		// may have been released while the topology installed its keepalives.
		for (const node of topology.graph.describe().nodes)
			if (node.value !== undefined) record(node.id, node.value);
		const bootstrapIds = new Set(authored.keys());
		const stop = topology.graph.observe().subscribe((event) => {
			if (event.msg[0] === "DATA") record(event.path, event.msg[1]);
		});
		const base = twoPhaseExecutor({
			onProvider(effect) {
				if (effect.dispatchOrdinal <= 4)
					return providerOutcome(effect, {
						status: "retryable",
						reason:
							effect.dispatchOrdinal <= 3
								? "http-capacity-retryable"
								: "http-availability-retryable",
						retryAfterMs: 0,
						cleanupCompleted: true,
						toolProposal: null,
					});
				return providerOutcome(effect);
			},
		});
		try {
			const result = await runRootEval(topology, async (effect) => {
				counts[effect.kind] = (counts[effect.kind] ?? 0) + 1;
				return base(effect);
			});
			expect(counts["eval-admitted-effect"]).toBe(175);
			expect(counts["eval-admitted-retry-delay"]).toBe(140);
			expect(counts["eval-admitted-tool-effect"]).toBe(35);
			expect(counts["eval-admitted-billing-observation"]).toBeLessThanOrEqual(8);
			expect([...released.entries()].sort()).toEqual([...authored.entries()].sort());
			const liveEntries = (values: Map<string, string>) =>
				[...values.entries()].filter(([id]) => !bootstrapIds.has(id)).sort();
			expect(liveEntries(arrivals)).toEqual(liveEntries(authored));
			const observations = result.observations
				.map(materialFreeObservationValue)
				.filter((value): value is EvalObservation => value !== undefined);
			expect(observations.length).toBeLessThan(rootEvalMaximumObservationOccurrences(5));
			expect(
				new Set(observations.map((value) => value.verificationDiagnostics.completedWorkItems)),
			).toEqual(new Set(Array.from({ length: 31 }, (_, index) => index)));
			expect(observations.filter((value) => value.finding !== "pending")).toHaveLength(1);
			expect(observations.at(-1)).toMatchObject({
				activeAdmittedEffects: 0,
				providerCallCount: 175,
				replicate: 5,
				completedArms: 6,
			});
		} finally {
			stop();
		}
	}, 30_000);

	it.each([
		"conflict",
		"skipped",
	] as const)("keeps reordered exact observation replays quiet and rejects %s revisions without changing spend", async (violation) => {
		const topology = createTopology();
		const arrivals = topology.nodes.observation.deps[0]!.deps[0]!;
		const contributions: { source: string; revision: number; digest: string; value: unknown }[] =
			[];
		const stopArrivals = arrivals.subscribe((message) => {
			if (message[0] === "DATA") contributions.push(...(message[1] as typeof contributions));
		});
		const observations: unknown[] = [];
		const rejections: unknown[] = [];
		const stopObservations = topology.nodes.observation.subscribe((message) => {
			if (message[0] === "DATA") observations.push(message[1]);
		});
		const stopRejections = topology.nodes.observationRejections.subscribe((message) => {
			if (message[0] === "DATA") rejections.push(message[1]);
		});
		try {
			await runRootEval(topology, twoPhaseExecutor());
			const count = observations.length;
			const before = JSON.stringify(topology.nodes.budgets.cache);
			arrivals.down([["DATA", [...contributions].reverse()]]);
			expect(observations).toHaveLength(count);
			expect(rejections).toEqual([]);
			const source = contributions.filter((event) => event.source === "diagnostics");
			const last = source.at(-1)!;
			const value =
				violation === "conflict"
					? { ...(last.value as object), completedWorkItems: -1 }
					: last.value;
			arrivals.down([
				[
					"DATA",
					[
						{
							...last,
							revision: violation === "conflict" ? last.revision : last.revision + 2,
							value,
							digest: empiricalStrictJsonDigest(value),
						},
					],
				],
			]);
			expect(rejections).toHaveLength(1);
			expect(rejections[0]).toMatchObject({
				kind: "eval-observation-rejected",
				code: "canonical-observation-invalid",
			});
			expect(JSON.stringify(topology.nodes.budgets.cache)).toBe(before);
		} finally {
			stopRejections();
			stopObservations();
			stopArrivals();
		}
	});
	it("executes the D149 automatic precredential stage plan before live admission", async () => {
		const cases = [
			[
				"--execute-live",
				[
					"long-gates",
					"bounded-currentness",
					"persist-receipt",
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
		expect(rootEvalPrecredentialStagePlan("--execute-live")).toContain("long-gates");
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
			boundary: "complete-domain-data-only",
			completeDomainOccurrence: true,
			materialFree: true,
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
			]),
		);
		expect(raw.nodes.map((node) => node.id)).not.toEqual(
			expect.arrayContaining([
				"eval/memory/exposure-request",
				"eval/memory/exposure-decisions",
				"eval/solution/agentic-memory-exposure/snapshot",
				"eval/solution/agentic-memory/retrieval/snapshot",
			]),
		);
	});

	it("conserves occurrence replay, revision, provenance, and bounded retention before delivery", () => {
		const ledger = new Map();
		const first = {
			occurrenceId: "campaign/replicate-1/memory-source/relevant",
			occurrenceRevision: 1,
			occurrenceDigest: empiricalStrictJsonDigest({ value: "first" }),
			occurrenceSourceRefs: [{ kind: "work-item", id: "source-1" }],
		};
		expect(admitRootEvalOccurrence(ledger, first, 1)).toBe("accepted");
		expect(admitRootEvalOccurrence(ledger, first, 1)).toBe("replay");
		expect(() =>
			admitRootEvalOccurrence(
				ledger,
				{ ...first, occurrenceDigest: empiricalStrictJsonDigest({ value: "conflict" }) },
				1,
			),
		).toThrow(/conflicted/u);
		expect(() =>
			admitRootEvalOccurrence(
				ledger,
				{ ...first, occurrenceSourceRefs: [{ kind: "work-item", id: "rebound" }] },
				1,
			),
		).toThrow(/conflicted/u);
		const revised = {
			...first,
			occurrenceRevision: 2,
			occurrenceDigest: empiricalStrictJsonDigest({ value: "revision-2" }),
		};
		expect(admitRootEvalOccurrence(ledger, revised, 1)).toBe("accepted");
		expect(() => admitRootEvalOccurrence(ledger, first, 1)).toThrow(/stale revision/u);
		expect(() =>
			admitRootEvalOccurrence(
				ledger,
				{
					...first,
					occurrenceId: "campaign/replicate-2/memory-source/relevant",
				},
				1,
			),
		).toThrow(/fixed bound/u);
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
			let stoppedResult: Awaited<ReturnType<typeof runRootEval>> | undefined;
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
			}).then((result) => {
				stoppedResult = result;
				stopped = true;
			});
			for (let turn = 0; turn < 8 && providerExecutionIds.length < 1; turn += 1)
				await vi.advanceTimersToNextTimerAsync();
			expect(providerExecutionIds).toHaveLength(1);
			vi.advanceTimersByTime(ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS);
			expect(elapsedStates.at(-1)?.state).toBe("exhausted");
			expect(stopped).toBe(false);
			for (const release of providerReleases) release();
			for (let turn = 0; turn < 32 && !stopped; turn += 1) await vi.advanceTimersByTimeAsync(0);
			await running;
			expect(stoppedResult).toMatchObject({
				finding: null,
				terminal: {
					status: "stopped",
					stoppingReason: "elapsed-budget-exhausted",
					cleanupComplete: true,
				},
			});
			expect(providerExecutionIds).toHaveLength(1);
			expect(toolExecutions).toBe(1);
			stopElapsed();
		} finally {
			vi.useRealTimers();
		}
	});

	it("freezes D157 no-network qualification with live authority closed", async () => {
		expect(await measureCurrentImplementation()).toBe(CURRENT_IMPLEMENTATION_MANIFEST_DIGEST);
		const implementationInputs = await measureCurrentImplementationInputs();
		for (const required of [
			"runtime/packages/ts/src/graph/index.ts",
			"runtime/packages/ts/src/solutions/work-item/index.ts",
			"runtime/packages/ts/src/solutions/agentic-memory/index.ts",
			"runtime/packages/ts/src/solutions/agentic-work-item-memory-application/index.ts",
			"focused-async-adapters.ts",
			"http-transport-leaf.ts",
			"private-diagnostic-sink.ts",
			"quiet-data-boundary.ts",
			"settled-spend.ts",
			"provider-cost-evidence.ts",
			"rollover-d145-charter-ledger.ts",
			"update-operator-configuration.ts",
			"toolchain/pnpm-lock.yaml",
		] as const)
			expect(implementationInputs[required], required).toMatch(/^sha256:[0-9a-f]{64}$/u);
		const packageManifest = JSON.parse(
			readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
		) as Record<string, unknown>;
		expect(implementationInputs["toolchain/packages/ts/package.json"]).toBe(
			measureReleaseInvariantPackageManifest(packageManifest),
		);
		expect(
			measureReleaseInvariantPackageManifest({ ...packageManifest, version: "999.999.999" }),
		).toBe(measureReleaseInvariantPackageManifest(packageManifest));
		expect(
			measureReleaseInvariantPackageManifest({
				...packageManifest,
				scripts: { ...(packageManifest.scripts as Record<string, string>), test: "false" },
			}),
		).not.toBe(measureReleaseInvariantPackageManifest(packageManifest));
		expect(ROOT_EVAL_LIVE_DECISION_REF).toBe("graphrefly-ts:D152");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).toBe("root-eval-development-2026-09-01-d152-v1");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).toBe("root-eval-development-claim-2026-09-01-d152-v1");
		expect(ROOT_EVAL_LIVE_CLAIM_SCHEMA).toBe("graphrefly-ts.root-eval-live-claim.v21");
		expect(ROOT_EVAL_LIVE_EVIDENCE_SCHEMA).toBe("graphrefly-ts.root-eval-live-evidence.v27");
		expect(ROOT_EVAL_LIVE_PRECLAIM_FAILURE_SCHEMA).toBe(
			"graphrefly-ts.root-eval-live-preclaim-failure.v21",
		);
		expect(ROOT_EVAL_LIVE_PRECREDENTIAL_GATE_RECEIPT_SCHEMA).toBe(
			"graphrefly-ts.root-eval-live-precredential-gates.v6",
		);
		expect(ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT.schemaVersion).toBe(
			"graphrefly-ts.root-eval-live-no-network-qa.v52",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.schemaVersion).toBe(
			"graphrefly-ts.root-eval-live-qualification.v53",
		);
		expect(ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT.schemaVersion).toBe(
			"graphrefly-ts.root-eval-topology-no-network-qa.v47",
		);
		expect(ROOT_EVAL_TOPOLOGY_QUALIFICATION.schemaVersion).toBe(
			"graphrefly-ts.root-eval-topology-qualification.v48",
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
		expect(ROOT_EVAL_LIVE_QUALIFICATION.decisionRef).toBe("graphrefly-ts:D157");
		expect(ROOT_EVAL_LIVE_QUALIFICATION.implementationExecutionApprovalRef).toBe(
			"user-authorized-d157-implementation-no-network-2026-09-03",
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
		expect(ROOT_EVAL_LIVE_QUALIFICATION.currentLiveExecutionApprovalRef).toBeNull();
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
			currentLiveExecutionApprovalClosed: true,
			callerHorizonDecisionRequired: false,
			status: "qualified-no-network-d157-precommitted-development-horizon",
			occurrenceAwareSolutionDeliveryDecisionRef: "graphrefly-ts:D151",
			orthogonalMechanismFamilyDecisionRef: "graphrefly-ts:D152",
			occurrenceBoundCandidateToolDecisionRef: "graphrefly-ts:D156",
			precommittedDevelopmentHorizonDecisionRef: "graphrefly-ts:D157",
		});
		expect(ROOT_EVAL_TOPOLOGY_QUALIFICATION).toMatchObject({
			decisionRef: "graphrefly-ts:D157",
			executionApprovalRef: "user-authorized-d157-implementation-no-network-2026-09-03",
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
			currentLiveExecutionApprovalRef: null,
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
			currentLiveExecutionApprovalClosed: true,
			callerHorizonDecisionRequired: false,
			status: "no-network-occurrence-architecture-qualified",
			occurrenceAwareSolutionDeliveryDecisionRef: "graphrefly-ts:D151",
			orthogonalMechanismFamilyDecisionRef: "graphrefly-ts:D152",
			occurrenceBoundCandidateToolDecisionRef: "graphrefly-ts:D156",
			precommittedDevelopmentHorizonDecisionRef: "graphrefly-ts:D157",
		});
		expect(ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT.architectureMigration.complete).toBe(true);
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
		expect(source).not.toMatch(/setTimeout\([^)]*,\s*0\s*\)/u);
		expect(source.match(/ctx\.down\(\[\["RESOLVED"\]\]\)/gu)).toHaveLength(3);
		expect(source).not.toMatch(/if \(!emitted\) ctx\.down\(\[\["RESOLVED"\]\]\)/u);
		expect(source).toContain("admitRootEvalOccurrence");
		expect(source).toMatch(/owner\.initNode\(\s*merge<EvalAdmittedEffect>\(\)/u);
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
		expect(liveEntry).toMatch(
			/\["SIGHUP", "SIGINT", "SIGTERM"\][\s\S]+callerCancellation\.abort\(error\)[\s\S]+process\.off\(signal, handler\)/u,
		);
		expect(liveEntry).toMatch(/ROOT_EVAL_LIVE_CONSUMED_D121_APPROVAL = "graphrefly-ts:D121"/u);
		expect(liveEntry).toMatch(/ROOT_EVAL_LIVE_D121_REPAIR_RECEIPT = "graphrefly-ts:D124"/u);
		expect(liveEntry).toMatch(
			/ROOT_EVAL_LIVE_EXECUTION_APPROVAL =\s*"user-authorized:d157-development-5:usd-4\.138575:development-usd-40"/u,
		);
		expect(liveEntry).toMatch(/ROOT_EVAL_LIVE_EXECUTION_APPROVAL_SLOT = "development-5"/u);
		expect(liveEntry).toMatch(/ROOT_EVAL_LIVE_EXECUTION_APPROVAL_HARD_CAP_MICROUSD = 4_138_575/u);
		expect(liveEntry).toMatch(
			/ROOT_EVAL_LIVE_EXECUTION_AUTHORITY_STATE =\s*process\.env\.GRAPHREFLY_ROOT_EVAL_EXECUTION_AUTHORITY/u,
		);
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
		expect(liveEntry).toMatch(/qualifyRootEvalLivePrivateInputs/u);
		expect(liveEntry).toContain("runRootEvalPrecredentialStagePlan({");
		expect(liveEntry).not.toMatch(/--prepare-browser|--qualify-private-inputs/u);
		expect(liveEntry).toMatch(
			/stage === "private-input-admission"[\s\S]+qualifyRootEvalLivePrivateInputs[\s\S]+stage === "control-plane-admission"[\s\S]+readRootEvalLivePricing[\s\S]+preclaimPersistenceArmed = true[\s\S]+readRootEvalLiveCurrentKey/u,
		);
		expect(liveEntry).toMatch(/stage === "long-gates"[\s\S]+runPrecredentialGates\(\)/u);
		expect(liveEntry).toMatch(
			/stage === "bounded-currentness"[\s\S]+assertBoundedCurrentness\(\)/u,
		);
		expect(liveEntry).toMatch(
			/stage === "persist-receipt"[\s\S]+persistOrReusePrecredentialGateReceipt/u,
		);
		expect(liveEntry).toMatch(
			/async function persistOrReusePrecredentialGateReceipt[\s\S]+persistRootEvalLivePrecredentialGateReceipt/u,
		);
		expect(liveEntry).toMatch(
			/async function persistOrReusePrecredentialGateReceipt[\s\S]+replaceRootEvalLivePrecredentialGateReceipt/u,
		);
		expect(liveEntry).toMatch(
			/async function persistOrReusePrecredentialGateReceipt[\s\S]+readRootEvalLiveRefreshablePrecredentialGateReceipt[\s\S]+replaceRootEvalLivePrecredentialGateReceipt/u,
		);
		expect(liveEntry).not.toMatch(/reconcileConsumedDevelopmentPreclaimFailures/u);
		expect(liveEntry).toMatch(
			/readRootEvalD152Ledger\([\s\S]+currentOrdinal !== nextRootEvalD152DevelopmentOrdinal\(charterLedger\)/u,
		);
		expect(liveEntry).not.toMatch(/priorConsumedDevelopmentGenerationRefs/u);
		expect(liveEntry).not.toMatch(
			/charterLedger\.entries\.filter\(\(entry\) => entry\.campaignPurpose === "development"\)\.length \+ 1/u,
		);
		expect(liveEntry).toMatch(
			/async function assertBoundedCurrentness\(\): Promise<RootEvalLiveBoundedCurrentness>[\s\S]+measureCurrentImplementation\(\)[\s\S]+checkRootEvalGeneratedArtifactSnapshot\(\)[\s\S]+runGit\(\["rev-parse", "HEAD"\]\)[\s\S]+"diff", "HEAD"/u,
		);
		expect(liveEntry).toContain("process.env.GRAPHREFLY_ROOT_EVAL_EXECUTION_AUTHORITY");
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
		expect(liveRuntime).toMatch(/\.d152-provider-dispatches/u);
		expect(liveRuntime).not.toMatch(/\.d125-provider-dispatches/u);
		expect(liveRuntime).not.toMatch(/\.d121-provider-dispatches/u);
		const liveAuthority = readFileSync(
			new URL(
				"../../evals/graph-native-rerun-avoidance/root-eval-live-authority.ts",
				import.meta.url,
			),
			"utf8",
		);
		expect(liveAuthority).toContain("2026-09-01.d152.v1");
		expect(liveAuthority).toMatch(
			/const secondStat = await secondHandle\.stat\(\)[\s\S]+secondStat\.nlink !== 1[\s\S]+\(secondStat\.mode & 0o777\) !== 0o600[\s\S]+secondStat\.size !== stat\.size[\s\S]+await realpath\(resolved\)/u,
		);
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
			GRAPHREFLY_D152_ISOLATED_LIVE_CHILD: "1",
		});
		const packageJson = JSON.parse(
			readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
		) as { scripts: Record<string, string> };
		expect(packageJson.scripts["eval:root:operator-config:update"]).toBe(
			"tsx packages/ts/evals/graph-native-rerun-avoidance/update-operator-configuration.ts",
		);
		expect(packageJson.scripts["eval:root:private-inputs"]).toBeUndefined();
		const operatorConfigurationUpdate = readFileSync(
			new URL(
				"../../evals/graph-native-rerun-avoidance/update-operator-configuration.ts",
				import.meta.url,
			),
			"utf8",
		);
		expect(operatorConfigurationUpdate).toMatch(/replaceRootEvalLiveOperatorConfiguration/u);
		expect(operatorConfigurationUpdate).toMatch(
			/operator-configuration-committed-unverified[\s\S]+process\.exitCode = 1/u,
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
			"eval/budget/state",
			"eval/provider/start-spacing-readiness",
			"eval/observation/candidate-provider-proposal",
			"eval/observation/candidate-tool-admission",
			"eval/observation/candidate-tool-result",
			"eval/campaign/terminal",
			"eval/observation/arrivals",
			"eval/observation/canonical-state",
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
			claimStatus: "no-network-identifiability-only",
			efficacyClaim: "none",
			finding: {
				passCounts: {
					cold: 0,
					"relevant-applied": 5,
					"proposal-only": 0,
					"admission-rejected": 0,
					"irrelevant-applied": 0,
					"wrong-scope-applied": 0,
				},
			},
			peakConcurrentEffects: 1,
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
			{
				workItemId: "forged/replicate-5/wrong-scope-applied",
				arm: "wrong-scope-applied" as const,
			},
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
	}, 15_000);

	it("fails closed before exact-tool admission on cross-task or stale candidate catalogs", async () => {
		for (const fault of ["cross-task-ref", "stale-catalog"] as const) {
			let forged = false;
			await expect(
				runRootEval(
					createTopology(),
					twoPhaseExecutor({
						onProvider(effect) {
							const base = providerOutcome(effect);
							if (forged || effect.workItemRole !== "source") return base;
							forged = true;
							const current = rootEvalToolCandidateCatalog(
								ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!,
								"source",
								effect.workItemId,
							);
							const other = rootEvalToolCandidateCatalog(
								ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate % 5]!,
								"source",
								ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate % 5]!.sourceWorkItemRef,
							);
							const tool = Object.freeze({
								toolRef: "graphrefly.eval.exact-candidate-tool.v2" as const,
								candidateRef:
									fault === "cross-task-ref"
										? other.candidates[0].candidateRef
										: current.candidates[0].candidateRef,
								candidateCatalogDigest:
									fault === "stale-catalog" ? other.catalogDigest : current.catalogDigest,
							});
							return Object.freeze({
								...base,
								toolProposal: Object.freeze({
									...tool,
									argumentsDigest: empiricalStrictJsonDigest(tool),
								}),
							});
						},
					}),
				),
			).rejects.toThrow(/Graph admission receipt/u);
			expect(forged).toBe(true);
		}
	}, 15_000);

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
		await expect(
			runRootEval(
				createTopology(),
				twoPhaseExecutor({
					onProvider(effect) {
						return providerOutcome(effect, {
							status: "failed",
							reason: "http-capacity-exhausted",
							providerResponseKind: "http",
							httpStatus: 429,
							cleanupCompleted: true,
							toolProposal: null,
						});
					},
				}),
			),
		).rejects.toThrow(/Graph admission receipt/u);
	});

	it("derives recovery class from the factual HTTP receipt instead of the caller label", async () => {
		let injected = false;
		const result = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onProvider(effect) {
					if (!injected && effect.workItemRole === "target") {
						injected = true;
						return providerOutcome(effect, {
							status: "retryable",
							reason: "http-capacity-retryable",
							recoveryClass: "capacity",
							providerResponseKind: "http",
							httpStatus: 503,
							cleanupCompleted: true,
							toolProposal: null,
						});
					}
					return providerOutcome(effect);
				},
			}),
		);
		expect(result.finding.providerOutcomeReasonCounts).toMatchObject({
			"http-capacity-retryable": 0,
			"http-availability-retryable": 1,
		});
	});

	it("drains every already admitted effect before rejecting an invalid receipt", async () => {
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
		expect(delayedCompleted).toBe(5);
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

	it("fails closed before exact-tool admission on same-task cross-arm candidate replay", async () => {
		let forged = false;
		await expect(
			runRootEval(
				createTopology(),
				twoPhaseExecutor({
					onProvider(effect) {
						const base = providerOutcome(effect);
						if (forged || effect.workItemRole !== "target") return base;
						forged = true;
						const task = ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!;
						const otherWorkItemId = effect.workItemId.replace(/\/[^/]+$/u, "/relevant-applied");
						const other = rootEvalToolCandidateCatalog(task, "target", otherWorkItemId);
						const tool = Object.freeze({
							toolRef: "graphrefly.eval.exact-candidate-tool.v2" as const,
							candidateRef: other.candidates[0].candidateRef,
							candidateCatalogDigest: other.catalogDigest,
						});
						return Object.freeze({
							...base,
							toolProposal: Object.freeze({
								...tool,
								argumentsDigest: empiricalStrictJsonDigest(tool),
							}),
						});
					},
				}),
			),
		).rejects.toThrow(/provider outcome does not exactly match its Graph admission receipt/u);
		expect(forged).toBe(true);
	});

	it("rejects forged candidate bindings before the root Graph can admit provider work", () => {
		const bindings = rootEvalTaskBindings(ROOT_EVAL_DEVELOPMENT_TASKS);
		const forged = bindings.map((binding, index) =>
			index === 0
				? Object.freeze({
						...binding,
						sourceCandidateCatalogDigest: empiricalStrictJsonDigest("forged-catalog"),
					})
				: binding,
		);
		expect(() =>
			createTopology({
				taskDefinitions: ROOT_EVAL_DEVELOPMENT_TASKS,
				taskBindings: forged,
			}),
		).toThrow(/frozen candidate catalogs/u);
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
		const rawBypass = clone(raw);
		rawBypass.edges.push({
			from: "eval/memory/exposure-occurrence-input",
			to: "eval/memory/context-for-work-item",
		});
		expect(() => assertRootEvalTopologyContract(rawBypass)).toThrow(/raw-record bypass/u);
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
			["proposalOrder", "replicate-dispatchOrdinal-fixed-arm"],
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

	it("runs five ordered replicates with six concurrent WorkItems and one paced provider slot", async () => {
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

		expect(result.peakConcurrentEffects).toBe(1);
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
			topologyRevision: ROOT_EVAL_TOPOLOGY_REVISION,
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

	it("publishes atomic provider-admission cuts before projecting monotonic progress", async () => {
		type ProviderAdmissionCut = Readonly<{
			readonly kind: "eval-provider-admission-observation-cut";
			readonly revision: number;
			readonly budget: EvalBudgetState;
			readonly capacity: EvalProviderCapacityState;
			readonly activeProviderAdmissionIds: readonly string[];
		}>;
		const topology = createTopology();
		const cuts: ProviderAdmissionCut[] = [];
		const activities: EvalEffectActivitySnapshot[] = [];
		const stop = topology.graph
			.observe("eval/provider/admission-observation-cut")
			.subscribe((event) => {
				if (event.msg[0] === "DATA") cuts.push(event.msg[1] as ProviderAdmissionCut);
			});
		const stopActivity = topology.graph
			.observe("eval/observation/effect-activity")
			.subscribe((event) => {
				if (event.msg[0] === "DATA") activities.push(event.msg[1] as EvalEffectActivitySnapshot);
			});
		let result: Awaited<ReturnType<typeof runRootEval>>;
		try {
			result = await runRootEval(
				topology,
				twoPhaseExecutor({
					async onProvider(effect) {
						await new Promise<void>((resolve) => setTimeout(resolve, 1));
						return providerOutcome(effect);
					},
				}),
			);
		} finally {
			stop();
			stopActivity();
		}
		expect(cuts.length).toBeGreaterThan(result.executedAdmissionIds.length);
		for (let index = 0; index < cuts.length; index += 1) {
			const cut = cuts[index]!;
			if (index > 0) expect(cut.revision).toBe(cuts[index - 1]!.revision + 1);
			expect(cut.capacity.activeEffects).toBe(cut.activeProviderAdmissionIds.length);
			expect(cut.budget.activeEffects).toBe(cut.activeProviderAdmissionIds.length);
			expect(cut.capacity.admittedProposalCount).toBe(cut.budget.admittedAttempts);
			expect(cut.capacity.proposalCount).toBe(
				cut.capacity.pendingProposalCount +
					cut.capacity.admittedProposalCount +
					cut.capacity.rejectedProposalCount,
			);
		}
		expect(
			activities.every((activity) =>
				cuts.some(
					(cut) =>
						empiricalStrictJsonDigest(cut.budget) === activity.budgetDigest &&
						JSON.stringify(cut.activeProviderAdmissionIds) ===
							JSON.stringify(activity.activeProviderAdmissionIds),
				),
			),
		).toBe(true);
		const observations = result.observations
			.map(materialFreeObservationValue)
			.filter((value) => value !== undefined);
		expect(observations.length).toBeGreaterThan(1);
		for (let index = 1; index < observations.length; index += 1)
			expect(observations[index]!.providerCapacity.proposalCount).toBeGreaterThanOrEqual(
				observations[index - 1]!.providerCapacity.proposalCount,
			);
	});

	it("does not release the next provider dispatch before Graph pacing readiness", async () => {
		const callbacks: Array<() => void> = [];
		const delays: number[] = [];
		const controller = new AbortController();
		const topology = createTopology({
			providerPacingSetTimeout(callback, delayMs) {
				callbacks.push(callback);
				delays.push(delayMs);
				return callbacks.length as unknown as ReturnType<typeof setTimeout>;
			},
		});
		const admissions: EvalAdmittedEffect[] = [];
		const startSpacing: Array<Record<string, unknown>> = [];
		const stopStartSpacing = topology.graph
			.observe("eval/provider/start-spacing-readiness")
			.subscribe((event) => {
				if (event.msg[0] === "DATA") startSpacing.push(event.msg[1] as Record<string, unknown>);
			});
		const running = runRootEval(
			topology,
			async (effect) => {
				if (effect.kind === "eval-admitted-effect") {
					admissions.push(effect);
					return providerOutcome(effect, { dispatchElapsedMs: 12_000, elapsedMs: 12_000 });
				}
				return await twoPhaseExecutor()(effect);
			},
			{ signal: controller.signal },
		);
		for (let turn = 0; turn < 32 && admissions.length < 1; turn += 1)
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(admissions).toHaveLength(1);
		expect(delays).toEqual([18_000]);
		expect(startSpacing[0]).toMatchObject({
			kind: "eval-provider-start-spacing-readiness",
			dispatchElapsedMs: 12_000,
			remainingPacingDelayMs: 18_000,
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(admissions).toHaveLength(1);
		callbacks.shift()?.();
		for (let turn = 0; turn < 32 && admissions.length < 2; turn += 1)
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(admissions).toHaveLength(2);
		controller.abort(new Error("paced admission test complete"));
		await expect(running).rejects.toThrow(/paced admission test complete/u);
		stopStartSpacing();
	});

	it("does not execute a validated admission after cancellation during the deferred caller turn", async () => {
		const controller = new AbortController();
		const topology = createTopology();
		let callerAdmissionSeen = false;
		const stop = topology.nodes.executorEffects.subscribe((message) => {
			if (message[0] !== "DATA") return;
			callerAdmissionSeen = true;
			queueMicrotask(() => controller.abort(new Error("cancel before deferred caller turn")));
		});
		let executorCalls = 0;
		const running = runRootEval(
			topology,
			async (effect) => {
				executorCalls += 1;
				return await twoPhaseExecutor()(effect);
			},
			{ signal: controller.signal },
		);
		await expect(running).rejects.toThrow(/cancel before deferred caller turn/u);
		expect(callerAdmissionSeen).toBe(true);
		expect(executorCalls).toBe(0);
		stop();
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
			budgetPartition: "development-usd-36",
			partitionHardCapMicrousd: 36_000_000,
			partitionSpentBeforeMicrousd: 125_000,
			partitionLedgerDigest,
			developmentQualificationStreakBefore: 1,
			maxCostMicrousd: 35_875_000,
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
			budgetPartition: "development-usd-36",
			partitionHardCapMicrousd: 36_000_000,
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
				budgetPartition: "development-usd-36",
				partitionHardCapMicrousd: 36_000_000,
				partitionSpentBeforeMicrousd: 35_900_000,
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
		expect(result.peakConcurrentEffects).toBe(1);
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
				if (effect.replicate === 3 && effect.arm === "cold" && effect.dispatchOrdinal === 1)
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-capacity-retryable",
						retryAfterMs: 60_000,
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
					value.providerOutcomeReasonCounts["transport-availability-retryable"] +
					value.providerOutcomeReasonCounts["http-capacity-retryable"];
				return value.activeRetryEffects === retryableReasons - value.admittedRetryAttempts;
			}),
		).toBe(true);
		expect(
			observations.every(
				(value) =>
					value.activeRetryEffects === value.providerCapacity.cooldownOutstandingReadinessCount,
			),
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
						effect.replicate === 1 && effect.arm === "cold"
							? {
									status: "failed",
									reason: "executor-failed",
									recoveryClass: null,
									dispatchAttempted: false,
									providerResponseKind: "none",
									httpStatus: null,
									cleanupCompleted: true,
									toolProposal: null,
								}
							: {},
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
					if (effect.replicate === 1 && effect.arm === "cold" && effect.dispatchOrdinal === 1) {
						attemptOne = effect;
						return providerOutcome(effect, {
							status: "retryable",
							reason: "http-capacity-retryable",
							retryAfterMs: 60_000,
							cleanupCompleted: true,
							toolProposal: null,
						});
					}
					if (effect.replicate === 1 && effect.arm === "cold" && effect.dispatchOrdinal === 2)
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
			"http-capacity-retryable": 1,
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

	it("emits source retry observations only after the retry lifecycle reaches a stable cut", async () => {
		const result = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onProvider(effect) {
					if (
						effect.workItemRole === "source" &&
						effect.replicate === 1 &&
						effect.dispatchOrdinal === 1
					)
						return providerOutcome(effect, {
							status: "retryable",
							reason: "http-capacity-retryable",
							retryAfterMs: 120_000,
							cleanupCompleted: true,
							toolProposal: null,
						});
					return providerOutcome(effect);
				},
			}),
		);

		expect(result.executedAdmissionIds).toHaveLength(36);
		expect(result.finding.providerOutcomeReasonCounts).toMatchObject({
			"http-capacity-retryable": 1,
			"tool-proposed": 35,
		});
		for (const [index, event] of result.observations.entries()) {
			if (event.msg[0] !== "DATA") continue;
			const observation = event.msg[1] as EvalObservation;
			expect(
				() => assertRootEvalObservationRuntimeShape(observation),
				`observation ${index} retryable=${observation.providerOutcomeReasonCounts["http-capacity-retryable"]} admittedRetry=${observation.admittedRetryAttempts} activeRetry=${observation.activeRetryEffects}`,
			).not.toThrow();
			const retryableReasonTotal =
				observation.providerOutcomeReasonCounts["transport-availability-retryable"] +
				observation.providerOutcomeReasonCounts["http-capacity-retryable"];
			expect(observation.activeRetryEffects).toBe(
				retryableReasonTotal - observation.admittedRetryAttempts,
			);
		}
	});

	it("lets the Graph exhaust a repeated transport-availability candidate", async () => {
		const result = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onProvider(effect) {
					if (effect.replicate === 1 && effect.arm === "cold")
						return providerOutcome(effect, {
							status: "retryable",
							reason: "transport-availability-retryable",
							retryAfterMs: 60_000,
							cleanupCompleted: true,
							toolProposal: null,
						});
					return providerOutcome(effect);
				},
			}),
		);
		expect(result.finding.providerOutcomeReasonCounts).toMatchObject({
			"transport-availability-retryable": 1,
			"transport-availability-exhausted": 1,
		});
	});

	it("conserves one full six-arm retryable replicate through dispatchOrdinal-two admission", async () => {
		const executed: EvalExecutableEffect[] = [];
		const base = twoPhaseExecutor({
			onProvider(effect) {
				if (
					effect.workItemRole === "target" &&
					effect.replicate === 1 &&
					effect.dispatchOrdinal === 1
				) {
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-capacity-retryable",
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
			"http-capacity-retryable": 6,
			"tool-proposed": 35,
		});
		const providerAdmissionOrder = executed.flatMap((effect) =>
			effect.kind === "eval-admitted-effect" && effect.workItemRole === "target"
				? [`${effect.arm}/dispatchOrdinal-${effect.dispatchOrdinal}`]
				: [],
		);
		expect(providerAdmissionOrder.slice(0, 5)).toEqual([
			"cold/dispatchOrdinal-1",
			"cold/dispatchOrdinal-2",
			"relevant-applied/dispatchOrdinal-1",
			"relevant-applied/dispatchOrdinal-2",
			"proposal-only/dispatchOrdinal-1",
		]);
		for (const arm of HARNESS_ARMS)
			expect(
				result.executedAdmissionIds.filter(
					(id) => id.includes(`/replicate-1/${arm}/`) && id.includes("/dispatch-2/"),
				),
			).toHaveLength(1);
		const capacitySnapshots = result.observations.map(
			(event) => (event.msg[1] as EvalObservation).providerCapacity,
		);
		expect(capacitySnapshots.some((snapshot) => snapshot.mode === "cooldown")).toBe(true);
		expect(capacitySnapshots.at(-1)).toMatchObject({
			mode: "paced-serial",
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

	it("conserves six retry proposals through the single paced provider lane", async () => {
		const base = twoPhaseExecutor({
			onProvider(effect) {
				if (
					effect.workItemRole === "target" &&
					effect.replicate === 1 &&
					effect.dispatchOrdinal === 1
				)
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-capacity-retryable",
						retryAfterMs: 60_000,
						cleanupCompleted: true,
						toolProposal: null,
					});
				return providerOutcome(effect);
			},
		});
		const result = await runRootEval(createTopology(), base);
		expect(result.finding).toMatchObject({ admittedAttempts: 41, completedWorkItems: 30 });
		expect(result.observations.at(-1)?.msg[1]).toMatchObject({
			retryProposalCount: 6,
			pendingRetryProposalCount: 0,
			admittedRetryAttempts: 6,
			settledRetryAttemptCount: 6,
		});
	});

	it("retains 429 capacity identity through three recoveries and terminal exhaustion", async () => {
		const coordinates: Array<readonly [number, number, number]> = [];
		const requests: EvalAdmittedEffect["request"][] = [];
		const executed: EvalExecutableEffect[] = [];
		const base = twoPhaseExecutor({
			onProvider(effect) {
				if (effect.workItemRole !== "target" || effect.replicate !== 1 || effect.arm !== "cold")
					return providerOutcome(effect);
				coordinates.push([
					effect.dispatchOrdinal,
					effect.capacityRetryOrdinal,
					effect.availabilityRetryOrdinal,
				]);
				requests.push(effect.request);
				return providerOutcome(effect, {
					status: "retryable",
					reason: "http-capacity-retryable",
					retryAfterMs: [60_000, 120_000, 240_000][effect.capacityRetryOrdinal] ?? 0,
					cleanupCompleted: true,
					toolProposal: null,
				});
			},
		});
		const result = await runRootEval(createTopology(), async (effect) => {
			executed.push(effect);
			return await base(effect);
		});
		expect(coordinates).toEqual([
			[1, 0, 0],
			[2, 1, 0],
			[3, 2, 0],
			[4, 3, 0],
		]);
		expect(requests.every((request) => request === requests[0])).toBe(true);
		expect(executed.filter((effect) => effect.kind === "eval-admitted-retry-delay")).toHaveLength(
			3,
		);
		expect(result.finding.providerOutcomeReasonCounts).toMatchObject({
			"http-capacity-retryable": 3,
			"http-capacity-exhausted": 1,
		});
		expect(result.finding.excludedTechnicalReplicates).toContain(1);
	});

	it("fails closed in the Graph when valid Retry-After exceeds the recovery envelope", async () => {
		const executed: EvalExecutableEffect[] = [];
		const base = twoPhaseExecutor({
			onProvider(providerEffect) {
				if (
					providerEffect.replicate === 1 &&
					providerEffect.arm === "cold" &&
					providerEffect.dispatchOrdinal === 1
				)
					return providerOutcome(providerEffect, {
						status: "retryable",
						reason: "http-capacity-retryable",
						retryAfterMs: 240_001,
						cleanupCompleted: true,
						toolProposal: null,
					});
				return providerOutcome(providerEffect);
			},
		});
		const result = await runRootEval(createTopology(), async (effect) => {
			executed.push(effect);
			return await base(effect);
		});
		expect(executed.filter((effect) => effect.kind === "eval-admitted-retry-delay")).toHaveLength(
			0,
		);
		expect(result.finding.providerOutcomeReasonCounts).toMatchObject({
			"http-capacity-retryable": 0,
			"http-capacity-exhausted": 1,
		});
		expect(result.finding.excludedTechnicalReplicates).toContain(1);
	});

	it("fails closed when Graph-visible cooldown readiness fails", async () => {
		const base = twoPhaseExecutor({
			onProvider(effect) {
				if (effect.replicate === 1 && effect.arm === "cold" && effect.dispatchOrdinal === 1)
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-capacity-retryable",
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
				if (effect.replicate === 1 && effect.arm === "cold" && effect.dispatchOrdinal === 1)
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-capacity-retryable",
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
		expect(providerExecutions.every((effect) => effect.dispatchOrdinal === 1)).toBe(true);
		expect(
			providerExecutions.filter((effect) => effect.workItemRole === "target").length,
		).toBeLessThanOrEqual(2);
	});

	it("lets the Graph retain capacity identity when a fourth recovery is requested", async () => {
		const executed: EvalExecutableEffect[] = [];
		const executor = twoPhaseExecutor({
			onProvider(effect) {
				if (effect.replicate === 1 && effect.arm === "cold")
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-capacity-retryable",
						retryAfterMs: 60_000,
						cleanupCompleted: true,
						toolProposal: null,
					});
				return providerOutcome(effect);
			},
		});

		const result = await runRootEval(createTopology(), async (effect) => {
			executed.push(effect);
			return executor(effect);
		});
		expect(executed.filter((effect) => effect.kind === "eval-admitted-retry-delay")).toHaveLength(
			3,
		);
		expect(
			executed
				.filter(
					(effect) =>
						effect.kind === "eval-admitted-effect" &&
						effect.replicate === 1 &&
						effect.arm === "cold",
				)
				.map((effect) => effect.dispatchOrdinal),
		).toEqual([1, 2, 3, 4]);
		expect(result.finding.providerOutcomeReasonCounts).toMatchObject({
			"http-capacity-retryable": 3,
			"http-capacity-exhausted": 1,
		});
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

	it("verification gates accept a behaviorally equivalent alternative", async () => {
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
	});

	it("verification gates reject a missing diff", async () => {
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
	});

	it("verification gates reject public semantic failure", async () => {
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
	});

	it("verification gates reject hidden verifier failure", async () => {
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
	});

	it("verification gates retain provider failure", async () => {
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
	});

	it("verification gates reject success-looking evidence from a failed exact tool", async () => {
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
	});

	it("verification gates prioritize exact-tool failure over no-change", async () => {
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
	});

	it("verification gates reject wrong-scope changes", async () => {
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
	});

	it("verification gates prioritize wrong scope over public semantic failure", async () => {
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
	});

	it("verification gates prioritize public semantic failure over hidden verifier failure", async () => {
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
	});

	it("verification gates prioritize incomplete cleanup over other failed stages", async () => {
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
	});

	it("verification gates retain executor exceptions as failed cleanup", async () => {
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
	});

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
							reason: "http-terminal",
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

		const result = await topology.runAdmittedEffects(
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
		);
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

	it("keeps the entire target verification lifecycle quiet when every source is technically excluded", async () => {
		const topology = createTopology();
		const targetMessages: string[] = [];
		const stop = topology.graph
			.observe("eval/verification/diff")
			.subscribe((event) => targetMessages.push(event.msg[0]));
		try {
			const result = await runRootEval(
				topology,
				twoPhaseExecutor({
					onProvider(effect) {
						expect(effect.workItemRole).toBe("source");
						return providerOutcome(effect, {
							status: "failed",
							reason: "transport-failed",
							cleanupCompleted: true,
							toolProposal: null,
						});
					},
				}),
			);
			expect(result.finding).toMatchObject({
				completedWorkItems: 0,
				evaluableReplicates: 0,
				sourceTechnicalExcludedReplicates: [1, 2, 3, 4, 5],
				finding: "operationally-inconclusive",
			});
			expect(targetMessages).not.toContain("DIRTY");
			expect(targetMessages).not.toContain("DATA");
		} finally {
			stop();
		}
	});

	it("keeps Graph-native spend observable when source verification fails closed", async () => {
		const topology = createTopology();
		const observations: EvalObservation[] = [];
		const stop = topology.graph.observe("eval/observation").subscribe((event) => {
			const value = materialFreeObservationValue(event);
			if (value !== undefined) observations.push(value);
		});
		let targetProviderCalls = 0;
		try {
			await expect(
				runRootEval(
					topology,
					twoPhaseExecutor({
						onProvider(effect) {
							if (effect.workItemRole === "target") targetProviderCalls += 1;
							return providerOutcome(effect);
						},
						onTool(effect) {
							const settled = outcome(effect);
							if (effect.workItemRole !== "source" || effect.replicate !== 1) return settled;
							return outcome(effect, {
								evidence: { ...settled.evidence, hiddenVerifier: "fail" },
							});
						},
					}),
				),
			).rejects.toThrow("source Work Item verification failed closed");
		} finally {
			stop();
		}
		const latest = observations.at(-1);
		expect(latest).toBeDefined();
		expect(latest).toMatchObject({
			campaignRef: topology.campaignRef,
			completedArms: 0,
			providerCallCount: 5,
			providerReportedMicrousd: 50,
			activeReservedMicrousd: 0,
			accountedUpperBoundMicrousd: 50,
			activeProviderEffects: 0,
			providerCapacity: {
				proposalCount: 5,
				pendingProposalCount: 0,
				admittedProposalCount: 5,
				settledProposalCount: 5,
			},
			finding: "pending",
		});
		expect(targetProviderCalls).toBe(0);
	});

	it("enforces dispatchOrdinal and cost budget ceilings independently and validates all budget inputs", async () => {
		for (const { options, expectedPeak } of [
			{
				options: { maxAttempts: 5, maxCostMicrousd: 6_000_000, reservationMicrousd: 1_000 },
				expectedPeak: 1,
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
			).resolves.toMatchObject({
				finding: null,
				terminal: { status: "stopped", stoppingReason: "budget-exhausted" },
			});
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
							reason: "http-terminal",
							costMicrousd: 1_200,
							costEvidence: "provider-reported",
							cleanupCompleted: true,
							toolProposal: null,
						});
					},
				}),
			),
		).resolves.toMatchObject({
			finding: null,
			terminal: { status: "stopped", stoppingReason: "budget-exhausted" },
		});
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
		expect(() =>
			createTopology({
				maxAttempts: rootEvalMaximumProviderAttempts(ROOT_EVAL_REPLICATE_COUNT) + 1,
			}),
		).toThrow("maxAttempts exceeded the root eval topology capacity");
	});

	it("settles a completed retry delay before a budget-rejected retry proposal", async () => {
		const topology = createTopology({
			maxAttempts: 60,
			maxCostMicrousd: 2_000,
			reservationMicrousd: 1_000,
		});
		const observations: EvalObservation[] = [];
		const stop = topology.graph.observe("eval/observation").subscribe((event) => {
			const value = materialFreeObservationValue(event);
			if (value !== undefined) observations.push(value);
		});
		try {
			await expect(
				runRootEval(
					topology,
					twoPhaseExecutor({
						onProvider(effect) {
							if (effect.replicate !== 1 || effect.dispatchOrdinal !== 1)
								return providerOutcome(effect);
							return providerOutcome(effect, {
								status: "retryable",
								reason: "http-capacity-retryable",
								costMicrousd: 1_100,
								retryAfterMs: 60_000,
								cleanupCompleted: true,
								toolProposal: null,
							});
						},
					}),
				),
			).resolves.toMatchObject({
				finding: null,
				terminal: { status: "stopped", stoppingReason: "budget-exhausted" },
			});
		} finally {
			stop();
		}
		const terminalStop = observations.at(-1);
		expect(terminalStop).toMatchObject({
			stoppingReason: "budget-exhausted",
			finding: "not-evaluated",
			activeProviderEffects: 0,
			activeRetryEffects: 0,
			activeAdmittedEffects: 0,
			admittedRetryAttempts: 0,
			retryProposalCount: 1,
			pendingRetryProposalCount: 0,
			rejectedRetryProposalCount: 1,
			settledRetryAttemptCount: 0,
			providerCapacity: {
				pendingProposalCount: 0,
				rejectedRetryProposalCount: 1,
			},
		});
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
		const batched = HARNESS_ARMS.slice(1, 3).map((arm) =>
			Object.freeze({
				...fact,
				arm,
				workItemId: `${topology.campaignRef}/replicate-1/${arm}`,
				resultDigest: empiricalStrictJsonDigest({ result: arm }),
			}),
		);
		topology.nodes.cleanup.down(batched.map((value) => ["DATA", value]));
		expect(
			diagnostics
				.slice(afterFirst)
				.map((value) => (value as { completedWorkItems: number }).completedWorkItems),
		).toEqual([2, 3]);
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

describe("D154 adaptive route settlement and coherent terminal QA", () => {
	it("preserves executor failure through Graph admission even with a nonbillable 429 receipt", async () => {
		const topology = createTopology({ maxAttempts: 1, reservationMicrousd: 100 });
		const effects: EvalExecutableEffect[] = [];
		const canonical: EvalProviderOutcome[] = [];
		const budgets: EvalBudgetState[] = [];
		const stopOutcome = topology.graph
			.observe("eval/provider/all-result-admissions")
			.subscribe((event) => {
				if (event.msg[0] === "DATA") canonical.push(event.msg[1] as EvalProviderOutcome);
			});
		const stopBudget = topology.nodes.budgets.subscribe((message) => {
			if (message[0] === "DATA") budgets.push(message[1] as EvalBudgetState);
		});
		const base = twoPhaseExecutor({
			onProvider(effect) {
				const proof = nonbillableCostEvidence({
					policyRef: ROOT_EVAL_NONBILLABLE_POLICY,
					admissionId: effect.admissionId,
					admissionReceiptDigest: effect.receiptDigest,
					requestDigest: empiricalSha256("D154 synthetic admitted request"),
					responseDigest: empiricalSha256("D154 synthetic 429 before observer fault"),
				});
				return providerOutcome(effect, {
					status: "failed",
					reason: "executor-failed",
					httpStatus: 429,
					costMicrousd: 0,
					costEvidence: "policy-qualified-nonbillable",
					nonbillableEvidence: proof,
					resultDigest: nonbillableHttpResultDigest(proof.responseDigest),
					toolProposal: null,
					cleanupCompleted: true,
				});
			},
		});
		try {
			await expect(
				runRootEval(topology, async (effect) => {
					effects.push(effect);
					return await base(effect);
				}),
			).rejects.toThrow("source Work Item non-technical failure failed closed");
		} finally {
			stopOutcome();
			stopBudget();
		}
		expect(canonical).toHaveLength(1);
		expect(canonical[0]).toMatchObject({
			status: "failed",
			reason: "executor-failed",
			recoveryClass: null,
			costEvidence: "policy-qualified-nonbillable",
			cleanupCompleted: true,
		});
		expect(budgets.at(-1)).toMatchObject({
			providerCallCount: 1,
			policyQualifiedNonbillableCount: 1,
			activeReservedMicrousd: 0,
			accountedUpperBoundMicrousd: 0,
		});
		expect(effects.filter((effect) => effect.kind === "eval-admitted-effect")).toHaveLength(1);
		expect(effects.some((effect) => effect.kind === "eval-admitted-retry-delay")).toBe(false);
	});

	it("rejects a mismatched first cost proof before freeing its active reservation", async () => {
		const topology = createTopology({ reservationMicrousd: 100 });
		const budgets: EvalBudgetState[] = [];
		const stop = topology.nodes.budgets.subscribe((message) => {
			if (message[0] === "DATA") budgets.push(message[1] as EvalBudgetState);
		});
		try {
			await expect(
				runRootEval(
					topology,
					twoPhaseExecutor({
						onProvider(effect) {
							const proof = nonbillableCostEvidence({
								policyRef: ROOT_EVAL_NONBILLABLE_POLICY,
								admissionId: effect.admissionId,
								admissionReceiptDigest: effect.receiptDigest,
								requestDigest: empiricalSha256("D154 admitted synthetic request"),
								responseDigest: empiricalSha256("D154 first response"),
							});
							return {
								...capacityOutcome(effect),
								costMicrousd: 0,
								costEvidence: "policy-qualified-nonbillable",
								nonbillableEvidence: proof,
								resultDigest: nonbillableHttpResultDigest(
									empiricalSha256("D154 different response"),
								),
							};
						},
					}),
				),
			).rejects.toThrow(/binding/);
			expect(budgets.at(-1)).toMatchObject({
				providerCallCount: 0,
				policyQualifiedNonbillableCount: 0,
				admittedAttempts: 1,
				activeReservedMicrousd: 100,
				accountedUpperBoundMicrousd: 100,
			});
		} finally {
			stop();
		}
	});

	it("conserves mixed reported, policy-qualified zero and unknown provider costs in the actual Graph", async () => {
		const topology = createTopology({ reservationMicrousd: 100 });
		const budgets: EvalBudgetState[] = [];
		const stop = topology.nodes.budgets.subscribe((message) => {
			if (message[0] === "DATA") budgets.push(message[1] as EvalBudgetState);
		});
		try {
			const result = await runRootEval(
				topology,
				twoPhaseExecutor({
					onProvider(effect) {
						if (
							effect.workItemRole === "source" &&
							effect.replicate === 1 &&
							effect.dispatchOrdinal === 1
						) {
							const proof = nonbillableCostEvidence({
								policyRef: ROOT_EVAL_NONBILLABLE_POLICY,
								admissionId: effect.admissionId,
								admissionReceiptDigest: effect.receiptDigest,
								requestDigest: empiricalSha256("D154 synthetic request"),
								responseDigest: empiricalSha256("D154 synthetic complete 429"),
							});
							return {
								...capacityOutcome(effect),
								costMicrousd: 0,
								costEvidence: "policy-qualified-nonbillable",
								nonbillableEvidence: proof,
								resultDigest: nonbillableHttpResultDigest(proof.responseDigest),
							};
						}
						if (effect.workItemRole === "target" && effect.replicate === 1 && effect.arm === "cold")
							return providerOutcome(effect, {
								status: "failed",
								reason: "http-terminal",
								httpStatus: 400,
								costMicrousd: effect.reservationMicrousd,
								costEvidence: "reservation-upper-bound",
								toolProposal: null,
								cleanupCompleted: true,
							});
						return providerOutcome(effect);
					},
				}),
			);
			expect(result.finding?.stoppingReason).toBe("campaign-complete");
			expect(budgets.at(-1)).toMatchObject({
				providerCallCount: 36,
				policyQualifiedNonbillableCount: 1,
				providerReportedMicrousd: 340,
				unreportedSettledUpperBoundMicrousd: 100,
				accountedUpperBoundMicrousd: 440,
				activeReservedMicrousd: 0,
				activeEffects: 0,
			});
		} finally {
			stop();
		}
	});

	function namedNode(topology: ReturnType<typeof createTopology>, name: string): Node<unknown> {
		const node = topology.graph.find(name);
		if (node === undefined) throw new Error(`D154 test could not find real dependency ${name}`);
		return node;
	}

	async function flushUntil(predicate: () => boolean): Promise<void> {
		for (let turn = 0; turn < 2_048 && !predicate(); turn += 1) await Promise.resolve();
		expect(predicate(), "bounded async effect delivery did not reach its test coordinate").toBe(
			true,
		);
	}

	function capacityOutcome(effect: EvalAdmittedEffect, retryAfterMs = 0): EvalProviderOutcome {
		return providerOutcome(effect, {
			status: "retryable",
			reason: "http-capacity-retryable",
			retryAfterMs,
			toolProposal: null,
			cleanupCompleted: true,
		});
	}

	it("adapts 30/60/120/240 seconds and recovers only after three usable responses across Work Items", async () => {
		const topology = createTopology();
		const intervals: number[] = [];
		const spacings: Array<Record<string, unknown>> = [];
		const providerEffects: EvalAdmittedEffect[] = [];
		const stop = topology.nodes.providerCapacity.subscribe((message) => {
			if (message[0] === "DATA")
				intervals.push((message[1] as EvalProviderCapacityState).providerStartIntervalMs);
		});
		const stopSpacing = topology.graph
			.observe("eval/provider/start-spacing-readiness")
			.subscribe((event) => {
				if (event.msg[0] === "DATA") spacings.push(event.msg[1] as Record<string, unknown>);
			});
		try {
			const result = await runRootEval(
				topology,
				twoPhaseExecutor({
					onProvider(effect) {
						providerEffects.push(effect);
						return effect.workItemRole === "source" &&
							effect.replicate === 1 &&
							effect.dispatchOrdinal <= 3
							? capacityOutcome(effect)
							: providerOutcome(effect);
					},
				}),
			);
			expect(result.finding?.stoppingReason).toBe("campaign-complete");
			expect([...new Set(intervals)]).toEqual([30_000, 60_000, 120_000, 240_000]);
			expect(spacings.slice(0, 12).map((value) => value.providerStartIntervalMs)).toEqual([
				60_000, 120_000, 240_000, 240_000, 240_000, 120_000, 120_000, 120_000, 60_000, 60_000,
				60_000, 30_000,
			]);
			expect(spacings.slice(3, 6).map((value) => value.consecutiveUsableResponses)).toEqual([
				1, 2, 0,
			]);
			expect(providerEffects.slice(3, 6).map((effect) => effect.replicate)).toEqual([1, 2, 3]);
			expect(new Set(providerEffects.slice(3, 6).map((effect) => effect.workItemId)).size).toBe(3);
			expect(spacings.map((value) => value.pacingRevision)).toEqual(
				spacings.map((_, index) => index + 1),
			);
		} finally {
			stopSpacing();
			stop();
		}
	});

	it("keeps identical cost-proof replay quiet and rejects a proof paired with another response", async () => {
		const callbacks: Array<() => void> = [];
		const topology = createTopology({
			providerPacingSetTimeout(callback) {
				callbacks.push(callback);
				return 0 as unknown as ReturnType<typeof setTimeout>;
			},
		});
		let candidate: EvalProviderOutcome | undefined;
		const spacings: unknown[] = [];
		const budgets: EvalBudgetState[] = [];
		const stop = topology.nodes.budgets.subscribe((message) => {
			if (message[0] === "DATA") budgets.push(message[1] as EvalBudgetState);
		});
		const stopSpacing = topology.graph
			.observe("eval/provider/start-spacing-readiness")
			.subscribe((event) => {
				if (event.msg[0] === "DATA") spacings.push(event.msg[1]);
			});
		const controller = new AbortController();
		const running = runRootEval(
			topology,
			twoPhaseExecutor({
				onProvider(effect) {
					const proof = nonbillableCostEvidence({
						policyRef: ROOT_EVAL_NONBILLABLE_POLICY,
						admissionId: effect.admissionId,
						admissionReceiptDigest: effect.receiptDigest,
						requestDigest: empiricalSha256("D154 exact request"),
						responseDigest: empiricalSha256("D154 exact error"),
					});
					candidate = capacityOutcome(effect);
					candidate = {
						...candidate,
						costMicrousd: 0,
						costEvidence: "policy-qualified-nonbillable",
						nonbillableEvidence: proof,
						resultDigest: nonbillableHttpResultDigest(proof.responseDigest),
					};
					return candidate;
				},
			}),
			{ signal: controller.signal },
		);
		const completion = running.then(
			() => null,
			(error: unknown) => error,
		);
		try {
			await flushUntil(() => callbacks.length === 1 && budgets.at(-1)?.providerCallCount === 1);
			const input = namedNode(topology, "eval/provider/result-input");
			const budgetBefore = empiricalStrictJsonDigest(budgets.at(-1));
			input.down([["DATA", candidate!]]);
			expect(spacings).toHaveLength(1);
			expect(empiricalStrictJsonDigest(budgets.at(-1))).toBe(budgetBefore);
			expect(budgets.at(-1)?.policyQualifiedNonbillableCount).toBe(1);
			const { evidenceDigest: _digest, ...proof } = candidate!.nonbillableEvidence!;
			expect(() =>
				input.down([
					[
						"DATA",
						{
							...candidate!,
							nonbillableEvidence: nonbillableCostEvidence({
								...proof,
								responseDigest: empiricalSha256("contradictory response"),
							}),
						},
					],
				]),
			).toThrow(/binding/);
			expect(budgets.at(-1)?.policyQualifiedNonbillableCount).toBe(1);
		} finally {
			controller.abort(new Error("D154 cost replay fixture cleanup"));
			await completion;
			stopSpacing();
			stop();
		}
	});

	it("retains response Retry-After after request exhaustion and applies route cooldown", async () => {
		const topology = createTopology();
		const exhausted: EvalProviderOutcome[] = [];
		const spacings: Array<Record<string, unknown>> = [];
		const stopResult = topology.graph
			.observe("eval/provider/all-result-admissions")
			.subscribe((event) => {
				if (
					event.msg[0] === "DATA" &&
					(event.msg[1] as EvalProviderOutcome).reason === "http-capacity-exhausted"
				)
					exhausted.push(event.msg[1] as EvalProviderOutcome);
			});
		const stopSpacing = topology.graph
			.observe("eval/provider/start-spacing-readiness")
			.subscribe((event) => {
				if (event.msg[0] === "DATA") spacings.push(event.msg[1] as Record<string, unknown>);
			});
		try {
			await runRootEval(
				topology,
				twoPhaseExecutor({
					onProvider(effect) {
						if (effect.workItemRole === "target" && effect.replicate === 1 && effect.arm === "cold")
							return {
								...capacityOutcome(effect, 180_000),
								dispatchElapsedMs: 200_000,
								elapsedMs: 200_000,
							};
						return providerOutcome(effect);
					},
				}),
			);
			expect(exhausted).toHaveLength(1);
			expect(exhausted[0]).toMatchObject({
				status: "failed",
				retryAfterMs: 0,
				responseRetryAfterMs: 180_000,
				capacityRetryOrdinal: 3,
			});
			expect(
				spacings.find((value) => value.admissionId === exhausted[0]!.admissionId),
			).toMatchObject({
				status: "failed",
				providerStartIntervalMs: 240_000,
				remainingPacingDelayMs: 180_000,
			});
		} finally {
			stopSpacing();
			stopResult();
		}
	});

	it("rejects stale pacing readiness even when its admission identity still matches", async () => {
		const callbacks: Array<() => void> = [];
		const topology = createTopology({
			providerPacingSetTimeout(callback) {
				callbacks.push(callback);
				return 0 as unknown as ReturnType<typeof setTimeout>;
			},
		});
		let readiness: Record<string, unknown> | undefined;
		let providers = 0;
		const stop = topology.graph
			.observe("eval/provider/start-spacing-readiness")
			.subscribe((event) => {
				if (event.msg[0] === "DATA") readiness = event.msg[1] as Record<string, unknown>;
			});
		const controller = new AbortController();
		const running = runRootEval(
			topology,
			twoPhaseExecutor({
				onProvider(effect) {
					providers += 1;
					return capacityOutcome(effect);
				},
			}),
			{ signal: controller.signal },
		);
		const completion = running.then(
			() => null,
			(error: unknown) => error,
		);
		try {
			await flushUntil(() => callbacks.length === 1);
			expect(() =>
				namedNode(topology, "eval/provider/pacing-clock").down([
					[
						"DATA",
						{
							kind: "eval-provider-pacing-clock",
							phase: "ready",
							readiness: { ...readiness!, pacingRevision: 0 },
						},
					],
				]),
			).toThrow(/scheduled occurrence/);
			expect(providers).toBe(1);
		} finally {
			controller.abort(new Error("D154 stale clock fixture cleanup"));
			await completion;
			stop();
		}
	});

	it("keeps a completed scientific finding when elapsed cutoff occurs during final billing", async () => {
		vi.useFakeTimers();
		const topology = createTopology();
		let heldBilling: EvalBillingObservationEffect | undefined;
		let releaseBilling: (() => void) | undefined;
		let complete = false;
		const controller = new AbortController();
		const base = twoPhaseExecutor();
		const running = runRootEval(
			topology,
			twoPhaseExecutor({
				onBilling(effect) {
					if (heldBilling !== undefined)
						return base(effect) as Promise<EvalBillingObservationOutcome>;
					heldBilling = effect;
					return new Promise<EvalBillingObservationOutcome>((resolve) => {
						releaseBilling = () => {
							void base(effect).then((value) => resolve(value as EvalBillingObservationOutcome));
						};
					});
				},
			}),
			{ signal: controller.signal },
		).finally(() => {
			complete = true;
		});
		void running.catch(() => undefined);
		try {
			await flushUntil(() => releaseBilling !== undefined);
			vi.advanceTimersByTime(ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS);
			expect(complete).toBe(false);
			releaseBilling!();
			const result = await running;
			expect(result.finding).toMatchObject({
				stoppingReason: "campaign-complete",
				completedWorkItems: 30,
				finding: "positive-differential",
			});
			expect(
				result.observations.map(materialFreeObservationValue).filter(Boolean).at(-1),
			).toMatchObject({
				stoppingReason: "campaign-complete",
				finding: "positive-differential",
				activeAdmittedEffects: 0,
			});
		} finally {
			controller.abort(new Error("D154 final billing fixture cleanup"));
			releaseBilling?.();
			await running.catch(() => undefined);
			vi.useRealTimers();
		}
	});

	it("rejects failed cleanup instead of publishing a successful incomplete-budget terminal", async () => {
		const topology = createTopology({ maxAttempts: 1 });
		const rejections: unknown[] = [];
		const stop = topology.nodes.observationRejections.subscribe((message) => {
			if (message[0] === "DATA") rejections.push(message[1]);
		});
		try {
			await expect(
				runRootEval(
					topology,
					twoPhaseExecutor({
						onTool(effect) {
							const result = outcome(effect);
							return { ...result, evidence: { ...result.evidence, cleanupCompleted: false } };
						},
					}),
				),
			).rejects.toThrow(/campaign-cleanup-failed/);
			expect(rejections).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "campaign-cleanup-failed" })]),
			);
		} finally {
			stop();
		}
	});

	it("drains already-produced source tools before a partial source-cohort budget stop", async () => {
		const topology = createTopology({ maxAttempts: 1 });
		let releaseTool: (() => void) | undefined;
		let providerCalls = 0;
		let targetCalls = 0;
		let finished = false;
		const controller = new AbortController();
		const running = runRootEval(
			topology,
			twoPhaseExecutor({
				onProvider(effect) {
					providerCalls += 1;
					if (effect.workItemRole === "target") targetCalls += 1;
					return providerOutcome(effect);
				},
				onTool(effect) {
					return new Promise<EvalEffectOutcome>((resolve) => {
						releaseTool = () => resolve(outcome(effect));
					});
				},
			}),
			{ signal: controller.signal },
		).finally(() => {
			finished = true;
		});
		void running.catch(() => undefined);
		try {
			await flushUntil(() => releaseTool !== undefined);
			expect(finished).toBe(false);
			releaseTool!();
			const result = await running;
			expect(result).toMatchObject({
				finding: null,
				terminal: {
					status: "stopped",
					cleanupComplete: true,
					stoppingReason: "budget-exhausted",
					completedTargetWorkItems: 0,
				},
			});
			expect(providerCalls).toBe(1);
			expect(targetCalls).toBe(0);
			expect(
				result.observations.map(materialFreeObservationValue).filter(Boolean).at(-1),
			).toMatchObject({
				finding: "not-evaluated",
				activeToolEffects: 0,
				activeProviderEffects: 0,
				activeAdmittedEffects: 0,
			});
		} finally {
			controller.abort(new Error("D154 source drain fixture cleanup"));
			releaseTool?.();
			await running.catch(() => undefined);
		}
	});
});
