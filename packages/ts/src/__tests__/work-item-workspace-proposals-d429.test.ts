import { describe, expect, it } from "vitest";
import {
	assertWorkspaceProposalDataOnly,
	decideWorkspaceProposalAdmission,
	projectWorkspaceProposalApplicationStatus,
	recordWorkspaceProposal,
	type WorkspaceProposalAdmissionDecision,
	type WorkspaceProposalAdmissionMaterial,
	type WorkspaceProposalReadyRequest,
	type WorkspaceProposalRecorded,
} from "../solutions/work-item/scheduling.js";

const actorRef = { kind: "actor", id: "actor-1" } as const;
const capabilityRef = { kind: "capability", id: "work-item-write" } as const;
const policyRef = { kind: "workspace-proposal-policy", id: "policy-1" } as const;
const projectionRef = { kind: "workspace-projection-bundle", id: "bundle-1" } as const;
const sourceRef = { kind: "side-panel-preview", id: "preview-1" } as const;
const targetRef = { kind: "work-item", id: "wi-1", revision: 1 } as const;

describe("Workspace proposal durable spine (D429)", () => {
	it("records a ready proposal and applies only family-specific emitted fact refs", () => {
		const recordResult = recordWorkspaceProposal(readyRequest());
		expect(recordResult.issues).toEqual([]);
		expect(recordResult.status.state).toBe("recorded");

		const record = mustRecord(recordResult.record);
		expect(record).toMatchObject({
			kind: "workspace-proposal-recorded",
			proposalId: "proposal-1",
			intakeRequestId: "intake-1",
			idempotencyKey: "idem-1",
			workspaceId: "workspace-1",
			proposalFamily: "work-item-domain-action",
			loweringKind: "side-panel-domain-action",
		});

		const admission = decideWorkspaceProposalAdmission(record, admissionMaterial());
		expect(admission.decision.status).toBe("admitted");
		expect(admission.issues).toEqual([]);

		const application = projectWorkspaceProposalApplicationStatus(record, admission.decision, {
			applicationId: "application-1",
			emittedFactRefs: [
				{
					proposalFamily: "work-item-domain-action",
					factKind: "work-item-domain-action-application",
					factId: "family-application-1",
				},
			],
		});

		expect(application.status.state).toBe("applied");
		expect(application.recorded?.emittedFactRefs).toEqual(application.status.emittedFactRefs);
		expect(Object.hasOwn(application.status, "created")).toBe(false);
		expect(Object.hasOwn(application.status, "workItemCreated")).toBe(false);
		expect(Object.hasOwn(application.status, "requiredInputSatisfied")).toBe(false);
	});

	it("blocks malformed recording and unsupported families before admission/application", () => {
		const malformed = recordWorkspaceProposal({
			kind: "workspace-proposal-ready-request",
			proposalId: "",
			workspaceId: "workspace-1",
		});
		expect(malformed.status.state).toBe("blocked");
		expect(malformed.issues.map((entry) => entry.code)).toContain("missing-proposal-id");

		const unsupported = recordWorkspaceProposal(readyRequest({ proposalFamily: "unknown-family" }));
		expect(unsupported.status.state).toBe("blocked");
		expect(unsupported.issues.map((entry) => entry.code)).toContain("unsupported-proposal-family");
	});

	it("defaults no matching policy to needs-review rather than admitted", () => {
		const record = mustRecord(recordWorkspaceProposal(readyRequest()).record);
		const admission = decideWorkspaceProposalAdmission(record, {
			...admissionMaterial(),
			policies: [],
		});

		expect(admission.decision.status).toBe("needs-review");
		expect(admission.issues.map((entry) => entry.code)).toContain("missing-policy");
	});

	it("requires an explicit admitting policy outcome", () => {
		const record = mustRecord(recordWorkspaceProposal(readyRequest()).record);
		const admission = decideWorkspaceProposalAdmission(record, {
			...admissionMaterial(),
			policies: [
				{
					kind: "workspace-proposal-admission-policy",
					policyId: "policy-without-outcome",
					proposalFamilies: ["work-item-domain-action"],
				},
			],
		});

		expect(admission.decision.status).toBe("needs-review");
		expect(admission.issues.map((entry) => entry.code)).toContain("missing-admission-outcome");
	});

	it("fails closed for missing policy, capability, idempotency, and freshness evidence", () => {
		const record = mustRecord(recordWorkspaceProposal(readyRequest()).record);
		const admission = decideWorkspaceProposalAdmission(record, {
			decisionId: "decision-missing-evidence",
		});

		expect(admission.decision.status).toBe("needs-review");
		expect(admission.issues.map((entry) => entry.code)).toEqual(
			expect.arrayContaining([
				"missing-policy",
				"missing-capability-evidence",
				"missing-idempotency-evidence",
				"missing-freshness-evidence",
				"missing-projection-freshness-evidence",
			]),
		);
	});

	it("fails closed for stale, unknown, duplicate, rejected, blocked, and conflicting admission material", () => {
		const record = mustRecord(recordWorkspaceProposal(readyRequest()).record);

		expect(
			decideWorkspaceProposalAdmission(record, admissionMaterial({ freshnessState: "stale" }))
				.decision.status,
		).toBe("blocked");
		expect(
			decideWorkspaceProposalAdmission(
				record,
				admissionMaterial({ freshnessState: "unknown" }),
			).issues.map((entry) => entry.code),
		).toContain("unknown-target-ref");
		expect(
			decideWorkspaceProposalAdmission(record, admissionMaterial({ idempotencyState: "conflict" }))
				.decision.status,
		).toBe("blocked");
		expect(
			decideWorkspaceProposalAdmission(record, admissionMaterial({ idempotencyState: "duplicate" }))
				.decision.status,
		).toBe("rejected");
		expect(
			decideWorkspaceProposalAdmission(record, admissionMaterial({ policyOutcome: "rejected" }))
				.decision.status,
		).toBe("rejected");
		expect(
			decideWorkspaceProposalAdmission(record, admissionMaterial({ policyOutcome: "blocked" }))
				.decision.status,
		).toBe("blocked");
		expect(
			decideWorkspaceProposalAdmission(record, {
				...admissionMaterial(),
				freshnessEvidence: [
					{ kind: "workspace-proposal-freshness-evidence", targetRef, state: "fresh" },
					{ kind: "workspace-proposal-freshness-evidence", targetRef, state: "stale" },
				],
			}).issues.map((entry) => entry.code),
		).toContain("conflicting-freshness-evidence");
	});

	it("requires policy-required capabilities and projection freshness evidence", () => {
		const record = mustRecord(recordWorkspaceProposal(readyRequest()).record);
		const extraCapabilityRef = { kind: "capability", id: "extra-write" } as const;
		const missingCapability = decideWorkspaceProposalAdmission(record, {
			...admissionMaterial(),
			policies: [
				{
					kind: "workspace-proposal-admission-policy",
					policyId: "policy-extra-capability",
					proposalFamilies: ["work-item-domain-action"],
					outcome: "admitted",
					requiredCapabilityRefs: [extraCapabilityRef],
				},
			],
		});
		expect(missingCapability.decision.status).toBe("blocked");
		expect(missingCapability.issues.map((entry) => entry.code)).toContain(
			"missing-policy-required-capability",
		);

		const staleProjection = decideWorkspaceProposalAdmission(
			record,
			admissionMaterial({ projectionFreshnessState: "stale" }),
		);
		expect(staleProjection.decision.status).toBe("blocked");
		expect(staleProjection.issues.map((entry) => entry.code)).toContain("stale-projection-ref");
	});

	it("blocks application for non-admitted, issueful, or envelope-mismatched decisions", () => {
		const record = mustRecord(recordWorkspaceProposal(readyRequest()).record);
		const admitted = decideWorkspaceProposalAdmission(record, admissionMaterial()).decision;

		expect(
			projectWorkspaceProposalApplicationStatus(
				record,
				{ ...admitted, status: "needs-review" },
				{
					applicationId: "application-review",
					emittedFactRefs: [familyRef()],
				},
			).status.state,
		).toBe("blocked");

		const issueful = {
			...admitted,
			issues: [
				{
					kind: "issue",
					source: "workspace-proposal",
					code: "manual-review-required",
					message: "review",
					severity: "error",
				},
			],
		} satisfies WorkspaceProposalAdmissionDecision;
		expect(
			projectWorkspaceProposalApplicationStatus(record, issueful, {
				applicationId: "application-issueful",
				emittedFactRefs: [familyRef()],
			}).issues.map((entry) => entry.code),
		).toContain("admission-decision-has-issues");

		expect(
			projectWorkspaceProposalApplicationStatus(
				record,
				{ ...admitted, workspaceId: "other-workspace" },
				{ applicationId: "application-mismatch", emittedFactRefs: [familyRef()] },
			).issues.map((entry) => entry.code),
		).toContain("proposal-envelope-mismatch");
	});

	it("leaves generic application pending without family projector refs and blocks mismatched refs", () => {
		const record = mustRecord(recordWorkspaceProposal(readyRequest()).record);
		const decision = decideWorkspaceProposalAdmission(record, admissionMaterial()).decision;

		const pending = projectWorkspaceProposalApplicationStatus(record, decision, {
			applicationId: "application-no-refs",
		});
		expect(pending.status.state).toBe("pending");
		expect(pending.status.code).toBe("pending-family-emitted-fact-refs");
		expect(pending.issues).toEqual([]);
		expect(pending.status).toMatchObject({
			idempotencyKey: "idem-1",
			targetRefs: [targetRef],
			policyRefs: [policyRef],
		});
		expect(
			projectWorkspaceProposalApplicationStatus(record, decision, {
				applicationId: "application-bad-refs",
				emittedFactRefs: [{ ...familyRef(), proposalFamily: "work-item-spawn" }],
			}).issues.map((entry) => entry.code),
		).toContain("family-ref-mismatch");
		expect(
			projectWorkspaceProposalApplicationStatus(record, decision, {
				applicationId: "application-fact-blob",
				emittedFactRefs: [
					{
						...familyRef(),
						fact: { kind: "work-item-created", id: "not-a-ref" },
					} as unknown as ReturnType<typeof familyRef>,
				],
			}).issues.map((entry) => entry.code),
		).toContain("malformed-family-emitted-fact-ref");
		expect(
			projectWorkspaceProposalApplicationStatus(record, decision, {
				applicationId: "application-unsupported-fact-kind",
				emittedFactRefs: [{ ...familyRef(), factKind: "required-input-response-applied" }],
			}).issues.map((entry) => entry.code),
		).toContain("unsupported-family-fact-kind");
	});

	it("rejects runtime/provider/credential/command/callback material and non-data shapes", () => {
		expect(
			recordWorkspaceProposal(readyRequest({ metadata: { callback: "handleSubmit" } })).issues.map(
				(entry) => entry.code,
			),
		).toContain("forbidden-runtime-material");
		expect(
			recordWorkspaceProposal(
				readyRequest({ metadata: { providerClient: "runtime-private" } }),
			).issues.map((entry) => entry.code),
		).toContain("forbidden-runtime-material");
		expect(
			recordWorkspaceProposal(
				readyRequest({ metadata: { credentialRef: "credential-1" } }),
			).issues.map((entry) => entry.code),
		).toContain("forbidden-runtime-material");

		expect(() => assertWorkspaceProposalDataOnly({ fn: () => undefined })).toThrow(
			/not structured data/,
		);
		expect(() => assertWorkspaceProposalDataOnly({ value: "https://example.com/runtime" })).toThrow(
			/not proposal data material/,
		);
		expect(() => assertWorkspaceProposalDataOnly({ [Symbol("hidden")]: "x" })).toThrow(
			/non-string key/,
		);
		const accessor = {};
		Object.defineProperty(accessor, "derived", { get: () => "nope" });
		expect(() => assertWorkspaceProposalDataOnly(accessor)).toThrow(/accessor/);
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(() => assertWorkspaceProposalDataOnly(cycle)).toThrow(/cycle/);
		const sparse = ["ok"];
		sparse.length = 2;
		expect(() => assertWorkspaceProposalDataOnly(sparse)).toThrow(/sparse array hole/);
		const shared = { kind: "source", id: "shared" };
		expect(() => assertWorkspaceProposalDataOnly({ left: shared, right: shared })).not.toThrow();
		expect(() => assertWorkspaceProposalDataOnly({ tokenCount: 12 })).not.toThrow();
	});

	it("records immutable durable material detached from caller-owned drafts", () => {
		const request = readyRequest();
		const result = recordWorkspaceProposal(request);
		const record = mustRecord(result.record);
		const mutableRequest = request as unknown as {
			draft: { patch: { summary: string } };
			readonly targetRefs: { [index: number]: WorkspaceProposalReadyRequest["targetRefs"][number] };
		};
		mutableRequest.draft.patch.summary = "mutated";
		mutableRequest.targetRefs[0] = {
			kind: "work-item",
			id: "other",
		};

		expect((record.draft as { patch: { summary: string } }).patch.summary).toBe("Updated");
		expect(record.targetRefs[0]).toEqual(targetRef);
		expect(() => {
			(
				record.targetRefs as unknown as {
					[index: number]: WorkspaceProposalReadyRequest["targetRefs"][number];
				}
			)[0] = targetRef;
		}).toThrow();
	});
});

function readyRequest(
	opts: Partial<WorkspaceProposalReadyRequest<Record<string, unknown>>> = {},
): WorkspaceProposalReadyRequest<Record<string, unknown>> {
	return {
		kind: "workspace-proposal-ready-request",
		proposalId: "proposal-1",
		intakeRequestId: "intake-1",
		idempotencyKey: "idem-1",
		workspaceId: "workspace-1",
		proposalFamily: "work-item-domain-action",
		loweringKind: "side-panel-domain-action",
		draft: { actionKind: "patch", patch: { summary: "Updated" } },
		targetRefs: [targetRef],
		actorRef,
		capabilityRefs: [capabilityRef],
		policyRefs: [policyRef],
		projectionBundleRefs: [projectionRef],
		sourceRefs: [sourceRef],
		audit: { auditId: "audit-1", actorId: "actor-1" },
		...opts,
	};
}

function admissionMaterial(
	opts: {
		readonly freshnessState?: "fresh" | "stale" | "unknown";
		readonly projectionFreshnessState?: "fresh" | "stale" | "unknown";
		readonly idempotencyState?: "unique" | "duplicate" | "conflict";
		readonly policyOutcome?: "admitted" | "rejected" | "blocked" | "needs-review";
	} = {},
): WorkspaceProposalAdmissionMaterial {
	return {
		decisionId: "decision-1",
		policies: [
			{
				kind: "workspace-proposal-admission-policy",
				policyId: "policy-1",
				proposalFamilies: ["work-item-domain-action"],
				outcome: opts.policyOutcome ?? "admitted",
			},
		],
		idempotencyEvidence: {
			kind: "workspace-proposal-idempotency-evidence",
			idempotencyKey: "idem-1",
			state: opts.idempotencyState ?? "unique",
		},
		freshnessEvidence: [
			{
				kind: "workspace-proposal-freshness-evidence",
				targetRef,
				state: opts.freshnessState ?? "fresh",
			},
		],
		projectionFreshnessEvidence: [
			{
				kind: "workspace-proposal-projection-freshness-evidence",
				projectionBundleRef: projectionRef,
				state: opts.projectionFreshnessState ?? "fresh",
			},
		],
		capabilityEvidence: [
			{
				kind: "workspace-proposal-capability-evidence",
				capabilityRef,
				state: "present",
			},
		],
		sourceRefs: [sourceRef],
	};
}

function familyRef() {
	return {
		proposalFamily: "work-item-domain-action" as const,
		factKind: "work-item-domain-action-application",
		factId: "family-application-1",
	};
}

function mustRecord(record: WorkspaceProposalRecorded | undefined): WorkspaceProposalRecorded {
	expect(record).toBeDefined();
	return record as WorkspaceProposalRecorded;
}
