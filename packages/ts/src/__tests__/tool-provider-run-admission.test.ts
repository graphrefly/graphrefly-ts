import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import { graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import type {
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderExecutionPolicy,
	ToolProviderRunAdmission,
	ToolProviderRunAdmissionDecision,
	ToolProviderRunAdmissionProposal,
	ToolProviderRunAdmissionStatus,
	ToolProviderRunAdmissionViews,
} from "../orchestration/agent-runtime.js";
import {
	requestToolProviderAdapterRun,
	toolProviderRunAdmissionProjector,
} from "../orchestration/agent-runtime.js";

const admissionProposalId = (runId: string) =>
	compoundTupleKey("tool-provider-run-admission-proposal", [runId]);
const defaultAdmissionId = (proposalId: string) =>
	compoundTupleKey("tool-provider-run-admission", [proposalId]);
const admittedRunId = (runId: string) => compoundTupleKey("tool-provider-run-admitted", [runId]);

function readyInput(
	opts: {
		readonly requestId?: string;
		readonly approvalMode?: "auto" | "require" | "never" | "custom";
	} = {},
): ToolProviderAdapterInput {
	const requestId = opts.requestId ?? "tool-request-admission";
	const policy =
		opts.approvalMode === undefined
			? undefined
			: ({
					kind: "tool-provider-execution-policy",
					policyId: `${requestId}:policy`,
					providerId: "provider-admission",
					approval: {
						mode: opts.approvalMode,
						sourceRefs: [{ kind: "approval-policy", id: `${requestId}:approval` }],
					},
				} satisfies ToolProviderExecutionPolicy);
	return {
		kind: "tool-provider-adapter-input",
		adapterInputId: `${requestId}:adapter-input`,
		status: "ready",
		requestId,
		operationId: `${requestId}:operation`,
		routeId: `${requestId}:route`,
		providerId: "provider-admission",
		executorId: "executor-admission",
		profileId: "profile-admission",
		toolName: "process.exec",
		operation: "run",
		policies: policy === undefined ? undefined : [policy],
		policyRefs:
			policy === undefined
				? undefined
				: [{ kind: "tool-provider-execution-policy", id: policy.policyId }],
		sourceRefs: [{ kind: "agent-request", id: requestId }],
	};
}

function createHarness() {
	const g = graph();
	const inputs = g.node<ToolProviderAdapterInput>([], null, {
		name: "admission-inputs",
	});
	const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
		name: "admission-run-requests",
	});
	const decisions = g.node<ToolProviderRunAdmissionDecision>([], null, {
		name: "admission-decisions",
	});
	const bundle = toolProviderRunAdmissionProjector(g, {
		inputs,
		runRequests: [runRequests],
		decisions: [decisions],
		now: () => 1234,
	});
	const seen = {
		proposals: [] as ToolProviderRunAdmissionProposal[],
		admissions: [] as ToolProviderRunAdmission[],
		approved: [] as ToolProviderAdapterRunRequested[],
		status: [] as ToolProviderRunAdmissionStatus[],
		issues: [] as DataIssue[],
		views: [] as ToolProviderRunAdmissionViews[],
	};
	bundle.proposals.subscribe(
		(msg) => msg[0] === "DATA" && seen.proposals.push(msg[1] as ToolProviderRunAdmissionProposal),
	);
	bundle.admissions.subscribe(
		(msg) => msg[0] === "DATA" && seen.admissions.push(msg[1] as ToolProviderRunAdmission),
	);
	bundle.approvedRunRequests.subscribe(
		(msg) => msg[0] === "DATA" && seen.approved.push(msg[1] as ToolProviderAdapterRunRequested),
	);
	bundle.status.subscribe(
		(msg) => msg[0] === "DATA" && seen.status.push(msg[1] as ToolProviderRunAdmissionStatus),
	);
	bundle.issues.subscribe((msg) => msg[0] === "DATA" && seen.issues.push(msg[1] as DataIssue));
	bundle.views.subscribe(
		(msg) => msg[0] === "DATA" && seen.views.push(msg[1] as ToolProviderRunAdmissionViews),
	);
	return { inputs, runRequests, decisions, seen };
}

describe("toolProviderRunAdmissionProjector (D419)", () => {
	it("emits a visible admitted run request for auto approval without mutating the candidate", () => {
		const harness = createHarness();
		const input = readyInput({ requestId: "auto-run", approvalMode: "auto" });
		const candidate = requestToolProviderAdapterRun(input, {
			runId: "candidate-auto",
			reason: "manual",
		});

		harness.inputs.down([["DATA", input]]);
		harness.runRequests.down([["DATA", candidate]]);

		expect(harness.seen.proposals).toEqual([
			expect.objectContaining({
				proposalId: admissionProposalId("candidate-auto"),
				approvalMode: "auto",
				runId: "candidate-auto",
			}),
		]);
		expect(harness.seen.admissions).toEqual([
			expect.objectContaining({
				state: "admitted",
				runId: "candidate-auto",
				approvedRunId: admittedRunId("candidate-auto"),
			}),
		]);
		expect(harness.seen.approved).toEqual([
			expect.objectContaining({
				runId: admittedRunId("candidate-auto"),
				adapterInputId: input.adapterInputId,
				metadata: expect.objectContaining({
					admissionId: defaultAdmissionId(admissionProposalId("candidate-auto")),
					approvedFromRunId: "candidate-auto",
				}),
			}),
		]);
		expect(candidate.runId).toBe("candidate-auto");
	});

	it("waits for a graph-visible admission decision when approval is required", () => {
		const harness = createHarness();
		const input = readyInput({ requestId: "require-run", approvalMode: "require" });
		const candidate = requestToolProviderAdapterRun(input, {
			runId: "candidate-require",
			reason: "manual",
		});

		harness.inputs.down([["DATA", input]]);
		harness.runRequests.down([["DATA", candidate]]);

		expect(harness.seen.status).toEqual([
			expect.objectContaining({
				proposalId: admissionProposalId("candidate-require"),
				state: "waiting",
			}),
		]);
		expect(harness.seen.approved).toEqual([]);

		harness.decisions.down([
			[
				"DATA",
				{
					kind: "tool-provider-run-admission-decision",
					decisionId: "decision-approve",
					proposalId: admissionProposalId("candidate-require"),
					admissionId: "admission-approve",
					outcome: "admit",
					approvedRunId: "approved-require-run",
					decidedByRef: { kind: "human", id: "operator" },
				},
			],
		]);

		expect(harness.seen.admissions.at(-1)).toEqual(
			expect.objectContaining({
				admissionId: "admission-approve",
				state: "admitted",
				decisionId: "decision-approve",
				approvedRunId: "approved-require-run",
			}),
		);
		expect(harness.seen.approved).toEqual([
			expect.objectContaining({
				runId: "approved-require-run",
				sourceRefs: expect.arrayContaining([
					{ kind: "tool-provider-run-admission-decision", id: "decision-approve" },
				]),
			}),
		]);
	});

	it("blocks never-approved runs without producing an executable run request", () => {
		const harness = createHarness();
		const input = readyInput({ requestId: "never-run", approvalMode: "never" });

		harness.inputs.down([["DATA", input]]);
		harness.runRequests.down([
			[
				"DATA",
				requestToolProviderAdapterRun(input, {
					runId: "candidate-never",
					reason: "manual",
				}),
			],
		]);

		expect(harness.seen.admissions).toEqual([
			expect.objectContaining({ runId: "candidate-never", state: "blocked" }),
		]);
		expect(harness.seen.status).toEqual([
			expect.objectContaining({ runId: "candidate-never", state: "blocked" }),
		]);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({ code: "tool-provider-run-admission-blocked" }),
		]);
		expect(harness.seen.approved).toEqual([]);
	});

	it("rejects stale run requests at the admission gate", () => {
		const harness = createHarness();
		const input = readyInput({ requestId: "stale-run", approvalMode: "auto" });
		const stale = {
			...requestToolProviderAdapterRun(input, { runId: "candidate-stale", reason: "manual" }),
			requestId: "different-request",
		} satisfies ToolProviderAdapterRunRequested;

		harness.inputs.down([["DATA", input]]);
		harness.runRequests.down([["DATA", stale]]);

		expect(harness.seen.status).toEqual([
			expect.objectContaining({ runId: "candidate-stale", state: "issue" }),
		]);
		expect(harness.seen.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-run-request-stale-request" }),
			]),
		);
		expect(harness.seen.approved).toEqual([]);
	});

	it("treats the first admission decision as terminal for a proposal", () => {
		const harness = createHarness();
		const input = readyInput({ requestId: "duplicate-decision", approvalMode: "require" });
		const candidate = requestToolProviderAdapterRun(input, {
			runId: "candidate-duplicate-decision",
			reason: "manual",
		});

		harness.inputs.down([["DATA", input]]);
		harness.runRequests.down([["DATA", candidate]]);
		harness.decisions.down([
			[
				"DATA",
				{
					kind: "tool-provider-run-admission-decision",
					decisionId: "decision-first",
					proposalId: admissionProposalId("candidate-duplicate-decision"),
					admissionId: "admission-first",
					outcome: "admit",
					approvedRunId: "approved-first",
				},
			],
			[
				"DATA",
				{
					kind: "tool-provider-run-admission-decision",
					decisionId: "decision-second",
					proposalId: admissionProposalId("candidate-duplicate-decision"),
					admissionId: "admission-second",
					outcome: "admit",
					approvedRunId: "approved-second",
				},
			],
		]);

		expect(harness.seen.approved).toEqual([expect.objectContaining({ runId: "approved-first" })]);
		expect(harness.seen.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-run-admission-duplicate-decision" }),
			]),
		);
		expect(harness.seen.status).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					proposalId: admissionProposalId("candidate-duplicate-decision"),
					state: "issue",
				}),
			]),
		);
	});

	it("keeps admission views deduped when a run request is replayed", () => {
		const harness = createHarness();
		const input = readyInput({ requestId: "replay-run", approvalMode: "auto" });
		const candidate = requestToolProviderAdapterRun(input, {
			runId: "candidate-replay",
			reason: "manual",
		});

		harness.inputs.down([["DATA", input]]);
		harness.runRequests.down([["DATA", candidate]]);
		harness.runRequests.down([["DATA", candidate]]);

		const latestView = harness.seen.views.at(-1);
		expect(latestView?.proposalsByRun.get("candidate-replay")).toHaveLength(1);
		expect(latestView?.admissionsByRun.get("candidate-replay")).toHaveLength(1);
		expect(harness.seen.approved).toEqual([
			expect.objectContaining({ runId: admittedRunId("candidate-replay") }),
		]);
	});
});
