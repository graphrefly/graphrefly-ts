import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import { attachToolProviderAdapterRuntime } from "../executors/tool-provider-runtime.js";
import { graph } from "../graph/graph.js";
import { retryPolicy } from "../graph/resilience.js";
import { compoundTupleKey } from "../identity.js";
import type {
	ExecutorOutcome,
	ScheduledReadinessReady,
	ScheduledReadinessRequested,
	SourceRef,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderRunAdmissionDecision,
	ToolProviderRunRetryPolicy,
	ToolProviderRunRetryProposal,
	ToolProviderRunRetryScheduled,
	ToolProviderRunRetryStatus,
	ToolProviderRunRetryViews,
} from "../orchestration/index.js";
import {
	toolProviderRunAdmissionProjector,
	toolProviderRunRetryProjector,
} from "../orchestration/index.js";

const retryRunId = (runId: string, attempt: number) =>
	compoundTupleKey("tool-provider-run-retry", [runId, String(attempt)]);
const retryProposalId = (outcomeId: string) =>
	compoundTupleKey("tool-provider-run-retry-proposal", [outcomeId]);
const retryScheduledId = (proposalId: string) =>
	compoundTupleKey("tool-provider-run-retry-scheduled", [proposalId]);
const retryReadinessScheduleId = (proposalId: string) =>
	compoundTupleKey("tool-provider-run-retry-readiness-schedule", [proposalId]);
const admissionProposalId = (runId: string) =>
	compoundTupleKey("tool-provider-run-admission-proposal", [runId]);

describe("toolProviderRunRetryProjector (D422)", () => {
	it("emits one immediate retry run request with attempt provenance", () => {
		const harness = createRetryHarness();
		const input = readyInput("retry-immediate");
		const outcome = retryableFailure(input, { attempt: 1, runId: "run-1" });

		harness.inputs.down([["DATA", input]]);
		harness.policies.down([["DATA", retryPolicyFact("retry-policy", 3)]]);
		harness.outcomes.down([["DATA", outcome]]);

		expect(harness.seen.proposals).toEqual([
			expect.objectContaining({
				outcomeId: outcome.outcomeId,
				fromRunId: "run-1",
				fromAttempt: 1,
				nextAttempt: 2,
				nextRunId: retryRunId("run-1", 2),
			}),
		]);
		expect(harness.seen.runRequests).toEqual([
			expect.objectContaining({
				runId: retryRunId("run-1", 2),
				adapterInputId: input.adapterInputId,
				attempt: 2,
				reason: "retry",
				retryOfOutcomeId: outcome.outcomeId,
				policyRefs: expect.arrayContaining([
					{ kind: "tool-provider-run-retry-policy", id: "retry-policy" },
				]),
				sourceRefs: expect.arrayContaining([
					{ kind: "executor-outcome", id: outcome.outcomeId },
					{ kind: "tool-provider-run-retry-proposal", id: retryProposalId(outcome.outcomeId) },
				]),
			}),
		]);
		expect(harness.seen.status).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					state: "ready",
					nextAttempt: 2,
					nextRunId: retryRunId("run-1", 2),
				}),
			]),
		);
	});

	it("emits exhausted status and no run request after maxAttempts", () => {
		const harness = createRetryHarness();
		const input = readyInput("retry-exhausted");
		const outcome = retryableFailure(input, { attempt: 2, runId: "run-2" });

		harness.inputs.down([["DATA", input]]);
		harness.policies.down([["DATA", retryPolicyFact("retry-policy", 2)]]);
		harness.outcomes.down([["DATA", outcome]]);

		expect(harness.seen.runRequests).toEqual([]);
		expect(harness.seen.status).toEqual([
			expect.objectContaining({
				outcomeId: outcome.outcomeId,
				state: "exhausted",
				issueCodes: ["tool-provider-run-retry-exhausted"],
			}),
		]);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({ code: "tool-provider-run-retry-exhausted" }),
		]);
	});

	it("does not duplicate retry proposals or requests when an outcome is replayed", () => {
		const harness = createRetryHarness();
		const input = readyInput("retry-replay");
		const outcome = retryableFailure(input, { attempt: 1, runId: "run-replay" });

		harness.inputs.down([["DATA", input]]);
		harness.policies.down([["DATA", retryPolicyFact("retry-policy", 3)]]);
		harness.outcomes.down([["DATA", outcome]]);
		harness.outcomes.down([["DATA", outcome]]);

		expect(harness.seen.proposals).toHaveLength(1);
		expect(harness.seen.runRequests).toHaveLength(1);
		expect(harness.seen.views.at(-1)?.nextRunRequestsByOutcome.get(outcome.outcomeId)).toEqual(
			expect.objectContaining({ runId: retryRunId("run-replay", 2) }),
		);
	});

	it("uses the exact outcome input id when multiple adapter inputs share a request", () => {
		const harness = createRetryHarness();
		const firstInput = readyInput("retry-exact-first");
		const secondInput = {
			...readyInput("retry-exact-second"),
			requestId: firstInput.requestId,
			operationId: firstInput.operationId,
		};
		const outcome = retryableFailure(secondInput, { attempt: 1, runId: "run-exact-second" });

		harness.inputs.down([["DATA", firstInput]]);
		harness.inputs.down([["DATA", secondInput]]);
		harness.policies.down([["DATA", retryPolicyFact("retry-policy", 3)]]);
		harness.outcomes.down([["DATA", outcome]]);

		expect(harness.seen.runRequests).toEqual([
			expect.objectContaining({
				adapterInputId: secondInput.adapterInputId,
				requestId: firstInput.requestId,
				runId: retryRunId("run-exact-second", 2),
			}),
		]);
	});

	it("fails closed when request-only outcomes match multiple adapter inputs", () => {
		const harness = createRetryHarness();
		const firstInput = readyInput("retry-ambiguous-first");
		const secondInput = {
			...readyInput("retry-ambiguous-second"),
			requestId: firstInput.requestId,
			operationId: firstInput.operationId,
		};
		const outcomeWithoutInputId = {
			...retryableFailure(firstInput, {
				attempt: 1,
				runId: "run-ambiguous",
			}),
		};
		delete outcomeWithoutInputId.inputId;

		harness.inputs.down([["DATA", firstInput]]);
		harness.inputs.down([["DATA", secondInput]]);
		harness.policies.down([["DATA", retryPolicyFact("retry-policy", 3)]]);
		harness.outcomes.down([["DATA", outcomeWithoutInputId]]);

		expect(harness.seen.runRequests).toEqual([]);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({ code: "tool-provider-run-retry-ambiguous-input" }),
		]);
		expect(harness.seen.status).toEqual([
			expect.objectContaining({
				state: "blocked",
				issueCodes: ["tool-provider-run-retry-ambiguous-input"],
			}),
		]);
	});

	it("re-evaluates retained outcomes when input and policy facts arrive later", () => {
		const harness = createRetryHarness();
		const input = readyInput("retry-out-of-order");
		const outcome = retryableFailure(input, { attempt: 1, runId: "run-out-of-order" });

		harness.outcomes.down([["DATA", outcome]]);
		expect(harness.seen.runRequests).toEqual([]);

		harness.inputs.down([["DATA", input]]);
		expect(harness.seen.runRequests).toEqual([]);

		harness.policies.down([["DATA", retryPolicyFact("retry-policy", 3)]]);

		expect(harness.seen.runRequests).toEqual([
			expect.objectContaining({
				runId: retryRunId("run-out-of-order", 2),
				attempt: 2,
				retryOfOutcomeId: outcome.outcomeId,
			}),
		]);
	});

	it("keeps delayed retry pending until a visible nowMs fact reaches retryAtMs", () => {
		const harness = createRetryHarness({ includeClock: true });
		const input = readyInput("retry-delayed");
		const outcome = retryableFailure(input, { attempt: 1, runId: "run-delayed" });

		harness.inputs.down([["DATA", input]]);
		harness.policies.down([
			["DATA", retryPolicyFact("retry-policy", 3, { kind: "constant", delayMs: 50 })],
		]);
		harness.nowMs?.down([["DATA", 1_000]]);
		harness.outcomes.down([["DATA", outcome]]);

		expect(harness.seen.scheduled).toEqual([
			expect.objectContaining({
				outcomeId: outcome.outcomeId,
				nextAttempt: 2,
				scheduleId: retryScheduledId(retryProposalId(outcome.outcomeId)),
				readinessScheduleId: retryReadinessScheduleId(retryProposalId(outcome.outcomeId)),
				retryAtMs: 1_050,
				retryAfterMs: 50,
			}),
		]);
		expect(harness.seen.readinessSchedules).toEqual([
			expect.objectContaining({
				kind: "scheduled-readiness-requested",
				scheduleId: retryReadinessScheduleId(retryProposalId(outcome.outcomeId)),
				readyAtMs: 1_050,
				reason: "tool-provider-retry",
			}),
		]);
		expect(harness.seen.runRequests).toEqual([]);

		harness.nowMs?.down([["DATA", 1_049]]);
		expect(harness.seen.runRequests).toEqual([]);

		harness.nowMs?.down([["DATA", 1_050]]);
		expect(harness.seen.runRequests).toEqual([
			expect.objectContaining({
				runId: retryRunId("run-delayed", 2),
				attempt: 2,
				retryOfOutcomeId: outcome.outcomeId,
			}),
		]);
	});

	it("can consume shared scheduled-readiness ready facts for delayed retries", () => {
		const harness = createRetryHarness({ includeClock: true, includeReadiness: true });
		const input = readyInput("retry-shared-ready");
		const outcome = retryableFailure(input, { attempt: 1, runId: "run-shared-ready" });

		harness.inputs.down([["DATA", input]]);
		harness.policies.down([
			["DATA", retryPolicyFact("retry-policy", 3, { kind: "constant", delayMs: 50 })],
		]);
		harness.nowMs?.down([["DATA", 1_000]]);
		harness.outcomes.down([["DATA", outcome]]);

		expect(harness.seen.runRequests).toEqual([]);
		const schedule = harness.seen.readinessSchedules[0];
		expect(schedule).toEqual(
			expect.objectContaining({
				scheduleId: retryReadinessScheduleId(retryProposalId(outcome.outcomeId)),
				readyAtMs: 1_050,
			}),
		);

		harness.nowMs?.down([["DATA", 1_050]]);
		expect(harness.seen.runRequests).toEqual([]);

		harness.readiness?.down([
			[
				"DATA",
				{
					kind: "scheduled-readiness-ready",
					scheduleId: schedule?.scheduleId ?? "missing",
					subjectRefs: schedule?.subjectRefs ?? [],
					readyAtMs: schedule?.readyAtMs ?? 0,
					nowMs: 1_050,
					sourceRefs: [
						{ kind: "scheduled-readiness", id: schedule?.scheduleId ?? "missing" },
						...(schedule?.sourceRefs ?? []),
					],
				},
			],
		]);

		expect(harness.seen.runRequests).toEqual([
			expect.objectContaining({
				runId: retryRunId("run-shared-ready", 2),
				attempt: 2,
				retryOfOutcomeId: outcome.outcomeId,
				sourceRefs: expect.arrayContaining([
					{ kind: "scheduled-readiness-ready", id: schedule?.scheduleId },
				]),
				metadata: expect.objectContaining({ readinessScheduleId: schedule?.scheduleId }),
			}),
		]);
	});

	it("rejects mismatched shared readiness facts without releasing a delayed retry early", () => {
		const harness = createRetryHarness({ includeClock: true, includeReadiness: true });
		const input = readyInput("retry-readiness-mismatch");
		const outcome = retryableFailure(input, { attempt: 1, runId: "run-readiness-mismatch" });

		harness.inputs.down([["DATA", input]]);
		harness.policies.down([
			["DATA", retryPolicyFact("retry-policy", 3, { kind: "constant", delayMs: 50 })],
		]);
		harness.nowMs?.down([["DATA", 1_000]]);
		harness.outcomes.down([["DATA", outcome]]);
		const schedule = harness.seen.readinessSchedules[0];

		harness.readiness?.down([
			[
				"DATA",
				{
					kind: "scheduled-readiness-ready",
					scheduleId: schedule?.scheduleId ?? "missing",
					subjectRefs: schedule?.subjectRefs ?? [],
					readyAtMs: 1_049,
					nowMs: 1_049,
					sourceRefs: [
						{ kind: "scheduled-readiness", id: schedule?.scheduleId ?? "missing" },
						...(schedule?.sourceRefs ?? []),
					],
				},
			],
		]);

		expect(harness.seen.runRequests).toEqual([]);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({ code: "tool-provider-run-retry-readiness-mismatch" }),
		]);
	});

	it("rejects malformed or unprovenanced shared readiness facts without releasing retry", () => {
		const harness = createRetryHarness({ includeClock: true, includeReadiness: true });
		const input = readyInput("retry-readiness-provenance");
		const outcome = retryableFailure(input, { attempt: 1, runId: "run-readiness-provenance" });

		harness.inputs.down([["DATA", input]]);
		harness.policies.down([
			["DATA", retryPolicyFact("retry-policy", 3, { kind: "constant", delayMs: 50 })],
		]);
		harness.nowMs?.down([["DATA", 1_000]]);
		harness.outcomes.down([["DATA", outcome]]);
		const schedule = harness.seen.readinessSchedules[0];

		harness.readiness?.down([
			[
				"DATA",
				{
					kind: "scheduled-readiness-ready",
					scheduleId: schedule?.scheduleId ?? "missing",
					subjectRefs: schedule?.subjectRefs ?? [],
					readyAtMs: schedule?.readyAtMs ?? 0,
					nowMs: 1_050,
					sourceRefs: { kind: "not-array", id: "bad" },
				} as unknown as ScheduledReadinessReady,
			],
		]);
		harness.readiness?.down([
			[
				"DATA",
				{
					kind: "scheduled-readiness-ready",
					scheduleId: schedule?.scheduleId ?? "missing",
					subjectRefs: schedule?.subjectRefs ?? [],
					readyAtMs: schedule?.readyAtMs ?? 0,
					nowMs: 1_050,
					sourceRefs: [{ kind: "external-ready", id: "unprovenanced" }],
				},
			],
		]);

		expect(harness.seen.runRequests).toEqual([]);
		expect(harness.seen.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-run-retry-readiness-malformed" }),
				expect.objectContaining({ code: "tool-provider-run-retry-readiness-mismatch" }),
			]),
		);
	});

	it("can schedule a delayed retry after the visible clock fact arrives later", () => {
		const harness = createRetryHarness({ includeClock: true });
		const input = readyInput("retry-clock-late");
		const outcome = retryableFailure(input, { attempt: 1, runId: "run-clock-late" });

		harness.inputs.down([["DATA", input]]);
		harness.policies.down([
			["DATA", retryPolicyFact("retry-policy", 3, { kind: "constant", delayMs: 25 })],
		]);
		harness.outcomes.down([["DATA", outcome]]);

		expect(harness.seen.proposals).toHaveLength(1);
		expect(harness.seen.scheduled).toEqual([]);
		expect(harness.seen.runRequests).toEqual([]);

		harness.nowMs?.down([["DATA", 2_000]]);

		expect(harness.seen.scheduled).toEqual([
			expect.objectContaining({ outcomeId: outcome.outcomeId, retryAtMs: 2_025 }),
		]);
		expect(harness.seen.runRequests).toEqual([]);

		harness.nowMs?.down([["DATA", 2_025]]);
		expect(harness.seen.runRequests).toEqual([
			expect.objectContaining({ runId: retryRunId("run-clock-late", 2), attempt: 2 }),
		]);
	});

	it("routes approval-required retry candidates through D419 admission before runtime execution", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "retry-admission-inputs" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "retry-admission-outcomes" });
		const policies = g.node<ToolProviderRunRetryPolicy>([], null, {
			name: "retry-admission-policies",
		});
		const decisions = g.node<ToolProviderRunAdmissionDecision>([], null, {
			name: "retry-admission-decisions",
		});
		const retry = toolProviderRunRetryProjector(g, {
			inputs,
			outcomes,
			policies: [policies],
		});
		const admission = toolProviderRunAdmissionProjector(g, {
			inputs,
			runRequests: [retry.runRequests],
			decisions: [decisions],
		});
		const calls: number[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [admission.approvedRunRequests],
			autoRunReadyInputs: false,
			bindings: [
				{
					providerId: "provider-retry",
					run(_input, ctx) {
						calls.push(ctx.attempt);
						return {
							kind: "result",
							result: { kind: "text", value: "approved", summary: "approved" },
						};
					},
				},
			],
		});
		const input = withApproval(readyInput("retry-admission"), "require");
		const outcome = retryableFailure(input, { attempt: 1, runId: "candidate-before-retry" });

		inputs.down([["DATA", input]]);
		policies.down([["DATA", retryPolicyFact("retry-policy", 3)]]);
		outcomes.down([["DATA", outcome]]);

		expect(calls).toEqual([]);

		decisions.down([
			[
				"DATA",
				{
					kind: "tool-provider-run-admission-decision",
					decisionId: "retry-admission-decision",
					proposalId: admissionProposalId(retryRunId("candidate-before-retry", 2)),
					admissionId: "retry-admission",
					outcome: "admit",
					approvedRunId: "retry-approved-run",
				},
			],
		]);

		expect(calls).toEqual([2]);
		runtime.dispose();
	});

	it("adapter runtime remains one-shot and does not internally retry retryable failures", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-no-retry-inputs" });
		const calls: number[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "provider-retry",
					run(input, ctx) {
						calls.push(ctx.attempt);
						return {
							kind: "failure",
							error: issue("runtime-retryable-failure", input.requestId),
							retryable: true,
						};
					},
				},
			],
		});

		inputs.down([["DATA", readyInput("runtime-no-retry")]]);

		expect(calls).toEqual([1]);
		runtime.dispose();
	});

	it("keeps artifact/ref material as provenance instead of inlining raw failure payloads", () => {
		const harness = createRetryHarness();
		const input = readyInput("retry-artifact");
		const artifactRef = { kind: "artifact", id: "stdout-ref" };
		const raw = "x".repeat(10_000);
		const outcome = retryableFailure(input, {
			attempt: 1,
			runId: "run-artifact",
			evidenceRefs: [artifactRef],
			metadata: { runId: "run-artifact", rawResponseBody: raw },
		});

		harness.inputs.down([["DATA", input]]);
		harness.policies.down([["DATA", retryPolicyFact("retry-policy", 3)]]);
		harness.outcomes.down([["DATA", outcome]]);

		const serialized = JSON.stringify(harness.seen.runRequests[0]);
		expect(harness.seen.runRequests[0]?.sourceRefs).toEqual(
			expect.arrayContaining([artifactRef, { kind: "executor-outcome", id: outcome.outcomeId }]),
		);
		expect(serialized).not.toContain(raw);
		expect(serialized.length).toBeLessThan(4_000);
	});

	it("canonicalizes upstream source refs before retry facts reuse them", () => {
		const harness = createRetryHarness();
		const input = {
			...readyInput("retry-ref-sanitize"),
			sourceRefs: [
				{
					kind: "agent-request",
					id: "retry-ref-sanitize:request",
					metadata: { apiKey: "SECRET-INPUT-REF" },
				},
			],
		};
		const outcome = retryableFailure(input, {
			attempt: 1,
			runId: "run-ref-sanitize",
			evidenceRefs: [
				{
					kind: "artifact",
					id: "raw-response-ref",
					metadata: { authorization: "SECRET-OUTCOME-REF" },
				},
			],
		});

		harness.inputs.down([["DATA", input]]);
		harness.policies.down([["DATA", retryPolicyFact("retry-policy", 3)]]);
		harness.outcomes.down([["DATA", outcome]]);

		const serialized = JSON.stringify(harness.seen.runRequests[0]);
		expect(serialized).not.toContain("SECRET-INPUT-REF");
		expect(serialized).not.toContain("SECRET-OUTCOME-REF");
		expect(harness.seen.runRequests[0]?.sourceRefs).toEqual(
			expect.arrayContaining([
				{ kind: "agent-request", id: "retry-ref-sanitize:request" },
				{ kind: "artifact", id: "raw-response-ref" },
			]),
		);
	});
});

function createRetryHarness(
	opts: { readonly includeClock?: boolean; readonly includeReadiness?: boolean } = {},
) {
	const g = graph();
	const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "retry-inputs" });
	const outcomes = g.node<ExecutorOutcome>([], null, { name: "retry-outcomes" });
	const policies = g.node<ToolProviderRunRetryPolicy>([], null, { name: "retry-policies" });
	const nowMs = opts.includeClock ? g.node<number>([], null, { name: "retry-now-ms" }) : undefined;
	const readiness = opts.includeReadiness
		? g.node<ScheduledReadinessReady>([], null, { name: "retry-readiness" })
		: undefined;
	const bundle = toolProviderRunRetryProjector(g, {
		inputs,
		outcomes,
		policies: [policies],
		...(nowMs === undefined ? {} : { nowMs }),
		...(readiness === undefined ? {} : { readiness: [readiness] }),
	});
	return {
		inputs,
		outcomes,
		policies,
		nowMs,
		readiness,
		seen: {
			proposals: collectData<ToolProviderRunRetryProposal>(bundle.proposals),
			scheduled: collectData<ToolProviderRunRetryScheduled>(bundle.scheduled),
			readinessSchedules: collectData<ScheduledReadinessRequested>(bundle.readinessSchedules),
			runRequests: collectData<ToolProviderAdapterRunRequested>(bundle.runRequests),
			status: collectData<ToolProviderRunRetryStatus>(bundle.status),
			issues: collectData<DataIssue>(bundle.issues),
			views: collectData<ToolProviderRunRetryViews>(bundle.views),
		},
	};
}

function readyInput(id: string): ToolProviderAdapterInput {
	return {
		kind: "tool-provider-adapter-input",
		adapterInputId: `${id}:adapter-input`,
		status: "ready",
		requestId: `${id}:request`,
		operationId: `${id}:operation`,
		routeId: `${id}:route`,
		providerId: "provider-retry",
		executorId: "executor-retry",
		profileId: "profile-retry",
		toolName: "retry.tool",
		operation: "run",
		sourceRefs: [{ kind: "agent-request", id: `${id}:request` }],
	};
}

function retryPolicyFact(
	policyId: string,
	maxAttempts: number,
	backoff: Parameters<typeof retryPolicy>[1] = { kind: "none" },
): ToolProviderRunRetryPolicy {
	return {
		kind: "tool-provider-run-retry-policy",
		policyId,
		retryPolicy: retryPolicy(maxAttempts, backoff),
		sourceRefs: [{ kind: "retry-policy", id: policyId }],
	};
}

function retryableFailure(
	input: ToolProviderAdapterInput,
	opts: {
		readonly attempt: number;
		readonly runId: string;
		readonly evidenceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	},
): ExecutorOutcome {
	return {
		kind: "failure",
		outcomeId: `${opts.runId}:outcome`,
		requestId: input.requestId,
		operationId: input.operationId,
		routeId: input.routeId ?? "route",
		executorId: input.executorId ?? "executor",
		profileId: input.profileId ?? "profile",
		attempt: opts.attempt,
		inputId: input.adapterInputId,
		...(opts.evidenceRefs === undefined ? {} : { evidenceRefs: opts.evidenceRefs }),
		metadata: opts.metadata ?? { runId: opts.runId },
		error: issue("retryable-failure", input.requestId),
		retryable: true,
	};
}

function withApproval(
	input: ToolProviderAdapterInput,
	mode: "auto" | "require" | "never",
): ToolProviderAdapterInput {
	const policyId = `${input.adapterInputId}:approval`;
	return {
		...input,
		policies: [
			{
				kind: "tool-provider-execution-policy",
				policyId,
				providerId: input.providerId ?? "provider-retry",
				approval: { mode },
			},
		],
		policyRefs: [{ kind: "tool-provider-execution-policy", id: policyId }],
	};
}

function issue(code: string, subjectId: string): DataIssue {
	return { kind: "issue", code, message: code, subjectId };
}

function collectData<T>(node: {
	subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
}): T[] {
	const out: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") out.push(msg[1] as T);
	});
	return out;
}
