import { describe, expect, it } from "vitest";
import { createSharedControlPanelAuthority } from "../solutions/shared-control-panel-authority.js";
import type {
	SharedControlPanelCanonicalTruth,
	SharedControlPanelCompletedOccurrence,
	SharedControlPanelGrant,
	SharedControlPanelHostSubscriptionRequest,
	SharedControlPanelRevision,
	SharedControlPanelSubscriptionRevision,
} from "../solutions/shared-control-panel-contracts.js";
import { sharedControlPanelAdmissionFingerprint } from "../solutions/shared-control-panel-contracts.js";
import { createSharedControlPanelMemoryPersistence } from "../testing/shared-control-panel-memory-persistence.js";

const pins = {
	tenantId: "tenant",
	workspaceId: "workspace",
	workGraphId: "graph",
	panelId: "panel",
	panelRevision: "v1",
	queryRevision: "query",
	specRevision: "spec",
	sourceRevision: "source",
	schemaRevision: "schema",
	artifactRevision: "artifact",
	inputRevision: "input",
	topologyFingerprint: "topology",
	policyRevision: "policy",
	redactionRevision: "redaction",
	environmentId: "environment",
	environmentRevision: "environment-v1",
	runId: "run",
	requestId: "request",
	attempt: 1,
	outcomeId: "outcome",
	runHighWater: 1,
	evidenceHighWater: 1,
	freshnessHighWater: 1,
};
const canonicalTruth = (
	overrides: Partial<typeof pins> = {},
): SharedControlPanelCanonicalTruth => ({
	kind: "shared-control-panel-canonical-truth",
	pins: { ...pins, ...overrides },
	recordedAtMs: 100,
});
const revision = (
	panelRevision: string,
	previousRevision: string | null,
): SharedControlPanelRevision => ({
	kind: "shared-control-panel-revision",
	pins: { ...pins, panelRevision },
	previousRevision,
	title: panelRevision,
	frames: [{ frameId: "frame", x: 0, y: 0, width: 1, height: 1 }],
	widgets: [
		{
			widgetId: "widget",
			frameId: "frame",
			bindingKind: "answer",
			bindingRef: "outcome",
			displayRevision: "display",
		},
	],
	immutableRefs: [{ kind: "executor-outcome", id: "outcome" }],
	createdBy: "owner",
	createdAtMs: 100,
});
const grant: SharedControlPanelGrant = {
	kind: "shared-control-panel-grant",
	grantId: "grant",
	tenantId: "tenant",
	panelId: "panel",
	panelRevision: "v1",
	subjectId: "viewer",
	capability: "subscribe",
	capabilityRevision: "cap-v1",
	policyRevision: "policy",
	redactionRevision: "redaction",
	issuedAtMs: 100,
	expiresAtMs: 1_000_000,
	revokedAtMs: null,
	actorSessionRevision: "session-v1",
};
const subscription = (
	subscriptionRevision = "sub-v1",
	previousRevision: string | null = null,
	active = true,
): SharedControlPanelSubscriptionRevision => ({
	kind: "shared-control-panel-subscription-revision",
	tenantId: "tenant",
	subscriptionId: "subscription",
	subscriptionRevision,
	previousRevision,
	panelId: "panel",
	panelRevision: "v1",
	subjectId: "viewer",
	pins,
	grantId: "grant",
	capabilityRevision: "cap-v1",
	actorSessionRevision: "session-v1",
	intervalMs: 60_000,
	scheduleAnchorMs: 150,
	expiresAtMs: 1_000_000,
	condition: "stale",
	conditionRevision: "condition-v1",
	staleAfterMs: 100,
	anomalyThreshold: 1,
	cooldownMs: 100,
	rateCap: 2,
	policyRevision: "policy",
	redactionRevision: "redaction",
	active,
	effectiveAtMs: 100,
});
const hostRequest = (
	action: "create" | "pause" | "resume" | "revoke",
	value: SharedControlPanelSubscriptionRevision,
	key: string,
): SharedControlPanelHostSubscriptionRequest => ({
	kind: "shared-control-panel-host-subscription-request",
	intent: {
		kind: "workspace-shared-control-panel-subscription-intent",
		contractVersion: "1",
		intentId: `intent-${key}`,
		idempotencyKey: key,
		action,
		binding: {} as never,
	},
	revision: value,
	admittedAtMs: 100,
	bindingAuthorityFingerprint: "binding",
});
async function seedSubscriptionHost() {
	const persistence = createSharedControlPanelMemoryPersistence();
	await persistence.createRevisionAndAdvanceHeadAtomically({
		value: revision("v1", null),
		idempotencyKey: "panel",
		hostNowMs: 100,
	});
	await persistence.recordCanonicalTruthAtomically({ value: canonicalTruth(), hostNowMs: 100 });
	await persistence.issueGrantAtomically({ value: grant, hostNowMs: 100 });
	return persistence;
}
const subscribeTruth = (observedAtMs: number) => ({
	kind: "shared-control-panel-current-truth" as const,
	pins,
	subjectId: "viewer",
	grantId: "grant",
	capability: "subscribe" as const,
	capabilityRevision: "cap-v1",
	currentPolicyRevision: "policy",
	currentRedactionRevision: "redaction",
	actorSessionRevision: "session-v1",
	observedAtMs,
});
const candidateBindingRefs = [
	{ kind: "query-revision", id: "query" },
	{ kind: "spec-revision", id: "spec" },
	{ kind: "input-revision", id: "input" },
	{ kind: "source-revision", id: "source" },
	{ kind: "schema-revision", id: "schema" },
];
async function seedCompletedOccurrence() {
	const persistence = await seedSubscriptionHost();
	const sub = subscription();
	await persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically({
		request: hostRequest("create", sub, "create"),
		authoritativeBindingFingerprint: "binding",
		hostNowMs: 100,
	});
	const claimed = await persistence.claimDueOccurrenceAtomically({
		subscription: sub,
		occurrenceId: "occurrence",
		dueAtMs: 150,
		evidenceFingerprint: "evidence",
		hostNowMs: 150,
	});
	if (!claimed.accepted || !claimed.value) throw new Error("expected-claim");
	const candidate = {
		kind: "shared-control-panel-run-candidate" as const,
		occurrenceId: "occurrence",
		createdAtMs: 150,
		request: {
			kind: "tool-provider-adapter-run-requested" as const,
			runId: "candidate-run",
			adapterInputId: "input",
			requestId: "candidate-request",
			operationId: "operation",
			attempt: 1,
			reason: "initial" as const,
			sourceRefs: candidateBindingRefs,
			metadata: {
				executionEnvironmentId: "environment",
				executionEnvironmentRevision: "environment-v1",
				executionEnvironmentLocality: "local",
				executionEnvironmentBindingKind: "local-host-process",
				executionSessionEpoch: "session:1",
			},
		},
	};
	const materialized = await persistence.materializeAuthorizedCandidateAtomically({
		occurrence: claimed.value,
		candidate,
		subscription: sub,
		truth: subscribeTruth(150),
		hostNowMs: 150,
	});
	if (!materialized.accepted || !materialized.value) throw new Error("expected-materialization");
	const admission = {
		kind: "tool-provider-run-admission" as const,
		admissionId: "admission",
		proposalId: "proposal",
		runId: "candidate-run",
		adapterInputId: "input",
		requestId: "candidate-request",
		operationId: "operation",
		state: "admitted" as const,
		decisionId: "decision",
		approvedRunId: "approved-run",
		sourceRefs: [{ kind: "candidate", id: "candidate-request" }],
	};
	await persistence.recordAdmissionForOccurrenceAtomically({
		value: {
			kind: "shared-control-panel-recorded-admission",
			tenantId: "tenant",
			occurrenceId: "occurrence",
			admission,
			bodyFingerprint: sharedControlPanelAdmissionFingerprint(admission),
			recordedAtMs: 150,
		},
		hostNowMs: 150,
	});
	const outcome = {
		kind: "shared-control-panel-recorded-terminal-outcome" as const,
		tenantId: "tenant",
		occurrenceId: "occurrence",
		runId: "approved-run",
		attempt: 1,
		outcomeId: "outcome-2",
		terminalHighWater: 2,
		outcomeEvidenceFingerprint: "outcome-evidence",
		evidenceRefs: [{ kind: "executor-outcome", id: "outcome-2" }],
		recordedAtMs: 150,
	};
	await persistence.recordVerifiedTerminalOutcomeAtomically({
		value: outcome,
		verified: {
			runId: outcome.runId,
			attempt: outcome.attempt,
			outcomeId: outcome.outcomeId,
			terminalHighWater: outcome.terminalHighWater,
			outcomeEvidenceFingerprint: outcome.outcomeEvidenceFingerprint,
			evidenceRefs: outcome.evidenceRefs,
		},
		hostNowMs: 150,
	});
	const completed: SharedControlPanelCompletedOccurrence = {
		kind: "shared-control-panel-completed-occurrence",
		occurrenceId: "occurrence",
		candidateRequestId: "candidate-request",
		candidateRunId: "candidate-run",
		admissionId: "admission",
		admissionSourceRefs: [{ kind: "tool-provider-run-admission", id: "admission" }],
		runId: "approved-run",
		attempt: 1,
		outcomeId: "outcome-2",
		terminalHighWater: 2,
		outcomeEvidenceFingerprint: "outcome-evidence",
		evidenceRefs: outcome.evidenceRefs,
		completedAtMs: 150,
	};
	const completedResult = await persistence.completeVerifiedOccurrenceAtomically({
		occurrence: materialized.value,
		completed,
		hostNowMs: 150,
	});
	if (!completedResult.accepted || !completedResult.value) throw new Error("expected-completion");
	return { persistence, sub, completed, occurrence: completedResult.value };
}

describe("D609 shared control-panel memory persistence conformance", () => {
	it("rolls back the whole atomic reducer including audit", async () => {
		const persistence = createSharedControlPanelMemoryPersistence();
		persistence.failNextCommit();
		await expect(
			persistence.recordCanonicalTruthAtomically({ value: canonicalTruth(), hostNowMs: 100 }),
		).rejects.toThrow("commit-failed");
		await expect(persistence.readOrderedAudit({ tenantId: "tenant" })).resolves.toEqual([]);
		await expect(
			persistence.recordCanonicalTruthAtomically({ value: canonicalTruth(), hostNowMs: 100 }),
		).resolves.toMatchObject({ accepted: true, code: "canonical-truth-recorded" });
		await expect(persistence.readOrderedAudit({ tenantId: "tenant" })).resolves.toMatchObject([
			{ sequence: 1 },
		]);
	});

	it("serializes concurrent expected-head CAS so exactly one writer wins", async () => {
		const persistence = createSharedControlPanelMemoryPersistence();
		const results = await Promise.all([
			persistence.createRevisionAndAdvanceHeadAtomically({
				value: revision("v1", null),
				idempotencyKey: "a",
				hostNowMs: 100,
			}),
			persistence.createRevisionAndAdvanceHeadAtomically({
				value: revision("v2", null),
				idempotencyKey: "b",
				hostNowMs: 100,
			}),
		]);
		expect(results.filter((result) => result.accepted)).toHaveLength(1);
		expect(results.filter((result) => !result.accepted)).toEqual([
			expect.objectContaining({ code: "panel-head-conflict" }),
		]);
	});

	it("rereferences exact idempotency bodies and conflicts on the same key with a different body", async () => {
		const persistence = createSharedControlPanelMemoryPersistence();
		const value = revision("v1", null);
		await persistence.createRevisionAndAdvanceHeadAtomically({
			value,
			idempotencyKey: "same",
			hostNowMs: 100,
		});
		await expect(
			persistence.createRevisionAndAdvanceHeadAtomically({
				value,
				idempotencyKey: "same",
				hostNowMs: 100,
			}),
		).resolves.toMatchObject({ accepted: true, code: "panel-revision-rereferenced" });
		await expect(
			persistence.createRevisionAndAdvanceHeadAtomically({
				value: { ...value, title: "changed" },
				idempotencyKey: "same",
				hostNowMs: 100,
			}),
		).resolves.toEqual({ accepted: false, code: "panel-idempotency-conflict" });
	});

	it("enforces monotonic truth and prevents mutable aliases from changing stored material", async () => {
		const persistence = createSharedControlPanelMemoryPersistence();
		const value = canonicalTruth();
		await persistence.recordCanonicalTruthAtomically({ value, hostNowMs: 100 });
		(value.pins as { runId: string }).runId = "mutated";
		await expect(
			persistence.recordCanonicalTruthAtomically({ value: canonicalTruth(), hostNowMs: 100 }),
		).resolves.toMatchObject({
			accepted: true,
			code: "canonical-truth-rereferenced",
			value: { pins: { runId: "run" } },
		});
		await expect(
			persistence.recordCanonicalTruthAtomically({
				value: canonicalTruth({ runHighWater: 0 }),
				hostNowMs: 100,
			}),
		).resolves.toEqual({ accepted: false, code: "canonical-truth-cas-conflict" });
		const audit = await persistence.readOrderedAudit({ tenantId: "tenant" });
		expect(audit.map((entry) => entry.sequence)).toEqual([1]);
		expect(Object.isFrozen(audit)).toBe(true);
	});

	it("uses the schedule anchor and admits exactly one concurrent occurrence at the due boundary", async () => {
		const persistence = await seedSubscriptionHost();
		const sub = subscription();
		await persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically({
			request: hostRequest("create", sub, "create"),
			authoritativeBindingFingerprint: "binding",
			hostNowMs: 100,
		});
		const before = await persistence.claimDueOccurrenceAtomically({
			subscription: sub,
			occurrenceId: "before",
			dueAtMs: 150,
			evidenceFingerprint: "evidence",
			hostNowMs: 149,
		});
		expect(before).toMatchObject({ accepted: false, code: "occurrence-not-due" });
		const results = await Promise.all([
			persistence.claimDueOccurrenceAtomically({
				subscription: sub,
				occurrenceId: "occurrence-a",
				dueAtMs: 150,
				evidenceFingerprint: "evidence",
				hostNowMs: 150,
			}),
			persistence.claimDueOccurrenceAtomically({
				subscription: sub,
				occurrenceId: "occurrence-b",
				dueAtMs: 150,
				evidenceFingerprint: "evidence",
				hostNowMs: 150,
			}),
		]);
		expect(results.filter((result) => result.accepted)).toHaveLength(1);
		expect(results.filter((result) => !result.accepted)).toEqual([
			expect.objectContaining({ code: "occurrence-conflict" }),
		]);
	});

	it("enforces subscription head, idempotency, pause/resume/revoke transitions", async () => {
		const persistence = await seedSubscriptionHost();
		const created = subscription();
		const create = hostRequest("create", created, "create");
		await expect(
			persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically({
				request: create,
				authoritativeBindingFingerprint: "binding",
				hostNowMs: 100,
			}),
		).resolves.toMatchObject({ accepted: true, code: "subscription-created" });
		await expect(
			persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically({
				request: create,
				authoritativeBindingFingerprint: "binding",
				hostNowMs: 100,
			}),
		).resolves.toMatchObject({ accepted: true, code: "subscription-rereferenced" });
		const paused = subscription("sub-v2", "sub-v1", false);
		await expect(
			persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically({
				request: hostRequest("pause", paused, "pause"),
				authoritativeBindingFingerprint: "binding",
				hostNowMs: 100,
			}),
		).resolves.toMatchObject({ accepted: true });
		const invalidPause = subscription("sub-v3", "sub-v2", false);
		await expect(
			persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically({
				request: hostRequest("pause", invalidPause, "pause-again"),
				authoritativeBindingFingerprint: "binding",
				hostNowMs: 100,
			}),
		).resolves.toEqual({ accepted: false, code: "invalid-subscription-transition" });
		const resumed = subscription("sub-v3", "sub-v2", true);
		await persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically({
			request: hostRequest("resume", resumed, "resume"),
			authoritativeBindingFingerprint: "binding",
			hostNowMs: 100,
		});
		const revoked = subscription("sub-v4", "sub-v3", false);
		await persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically({
			request: hostRequest("revoke", revoked, "revoke"),
			authoritativeBindingFingerprint: "binding",
			hostNowMs: 100,
		});
		await expect(
			persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically({
				request: hostRequest("resume", subscription("sub-v5", "sub-v4", true), "after-revoke"),
				authoritativeBindingFingerprint: "binding",
				hostNowMs: 100,
			}),
		).resolves.toEqual({ accepted: false, code: "subscription-revoked" });
	});

	it("binds admission, verified outcome, and completion to the exact occurrence candidate", async () => {
		const persistence = await seedSubscriptionHost();
		const sub = subscription();
		await persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically({
			request: hostRequest("create", sub, "create"),
			authoritativeBindingFingerprint: "binding",
			hostNowMs: 100,
		});
		const claimed = await persistence.claimDueOccurrenceAtomically({
			subscription: sub,
			occurrenceId: "occurrence",
			dueAtMs: 150,
			evidenceFingerprint: "evidence",
			hostNowMs: 150,
		});
		if (!claimed.accepted || !claimed.value) throw new Error("expected-claim");
		const candidate = {
			kind: "shared-control-panel-run-candidate" as const,
			occurrenceId: "occurrence",
			createdAtMs: 150,
			request: {
				kind: "tool-provider-adapter-run-requested" as const,
				runId: "candidate-run",
				adapterInputId: "input",
				requestId: "candidate-request",
				operationId: "operation",
				attempt: 1,
				reason: "initial" as const,
				sourceRefs: candidateBindingRefs,
				metadata: {
					executionEnvironmentId: "environment",
					executionEnvironmentRevision: "environment-v1",
					executionEnvironmentLocality: "local",
					executionEnvironmentBindingKind: "local-host-process",
					executionSessionEpoch: "session:1",
				},
			},
		};
		await expect(
			persistence.materializeAuthorizedCandidateAtomically({
				occurrence: claimed.value,
				candidate: {
					...candidate,
					request: {
						...candidate.request,
						sourceRefs: candidateBindingRefs.map((ref) =>
							ref.kind === "query-revision" ? { ...ref, id: "forged-query" } : ref,
						),
					},
				},
				subscription: sub,
				truth: subscribeTruth(150),
				hostNowMs: 150,
			}),
		).resolves.toEqual({ accepted: false, code: "candidate-subscription-binding-mismatch" });
		const materialized = await persistence.materializeAuthorizedCandidateAtomically({
			occurrence: claimed.value,
			candidate,
			subscription: sub,
			truth: subscribeTruth(150),
			hostNowMs: 150,
		});
		if (!materialized.accepted || !materialized.value) throw new Error("expected-materialization");
		const admission = {
			kind: "tool-provider-run-admission" as const,
			admissionId: "admission",
			proposalId: "proposal",
			runId: "candidate-run",
			adapterInputId: "input",
			requestId: "candidate-request",
			operationId: "operation",
			state: "admitted" as const,
			decisionId: "decision",
			approvedRunId: "approved-run",
			sourceRefs: [{ kind: "candidate", id: "candidate-request" }],
		};
		const recordedAdmission = {
			kind: "shared-control-panel-recorded-admission" as const,
			tenantId: "tenant",
			occurrenceId: "occurrence",
			admission,
			bodyFingerprint: sharedControlPanelAdmissionFingerprint(admission),
			recordedAtMs: 150,
		};
		await expect(
			persistence.recordAdmissionForOccurrenceAtomically({
				value: { ...recordedAdmission, occurrenceId: "other" },
				hostNowMs: 150,
			}),
		).resolves.toEqual({ accepted: false, code: "admission-owner-missing" });
		await persistence.recordAdmissionForOccurrenceAtomically({
			value: recordedAdmission,
			hostNowMs: 150,
		});
		const outcome = {
			kind: "shared-control-panel-recorded-terminal-outcome" as const,
			tenantId: "tenant",
			occurrenceId: "occurrence",
			runId: "approved-run",
			attempt: 1,
			outcomeId: "outcome-2",
			terminalHighWater: 2,
			outcomeEvidenceFingerprint: "outcome-evidence",
			evidenceRefs: [{ kind: "executor-outcome", id: "outcome-2" }],
			recordedAtMs: 150,
		};
		const verified = {
			runId: outcome.runId,
			attempt: outcome.attempt,
			outcomeId: outcome.outcomeId,
			terminalHighWater: outcome.terminalHighWater,
			outcomeEvidenceFingerprint: outcome.outcomeEvidenceFingerprint,
			evidenceRefs: outcome.evidenceRefs,
		};
		await persistence.recordVerifiedTerminalOutcomeAtomically({
			value: outcome,
			verified,
			hostNowMs: 150,
		});
		const completed: SharedControlPanelCompletedOccurrence = {
			kind: "shared-control-panel-completed-occurrence",
			occurrenceId: "occurrence",
			candidateRequestId: "candidate-request",
			candidateRunId: "candidate-run",
			admissionId: "admission",
			admissionSourceRefs: [{ kind: "tool-provider-run-admission", id: "admission" }],
			runId: "approved-run",
			attempt: 1,
			outcomeId: "outcome-2",
			terminalHighWater: 2,
			outcomeEvidenceFingerprint: "outcome-evidence",
			evidenceRefs: outcome.evidenceRefs,
			completedAtMs: 150,
		};
		await expect(
			persistence.completeVerifiedOccurrenceAtomically({
				occurrence: materialized.value,
				completed: { ...completed, admissionId: "forged" },
				hostNowMs: 150,
			}),
		).resolves.toEqual({ accepted: false, code: "completed-occurrence-correlation-mismatch" });
		await expect(
			persistence.completeVerifiedOccurrenceAtomically({
				occurrence: materialized.value,
				completed,
				hostNowMs: 150,
			}),
		).resolves.toMatchObject({ accepted: true, value: { state: "completed" } });
	});

	it("records an evaluated alert and isolates inbox delivery audience, redaction, and legal CAS", async () => {
		const { persistence, sub, completed, occurrence } = await seedCompletedOccurrence();
		const authority = createSharedControlPanelAuthority({
			persistence,
			clock: { now: () => 300 },
			terminalOutcomeAuthority: { lookup: async () => null },
			subscriptionBindingAuthority: { lookup: async () => null },
		});
		const signal = {
			observedAtMs: 300,
			lastSuccessfulRunAtMs: 0,
			value: 1,
			baseline: 1,
			evidenceFingerprint: "outcome-evidence",
			evidenceRefs: [{ kind: "executor-outcome", id: "outcome-2" }],
		};
		const alert = {
			kind: "shared-control-panel-alert" as const,
			alertId: "alert",
			tenantId: "tenant",
			occurrenceId: "occurrence",
			subscriptionId: "subscription",
			subscriptionRevision: "sub-v1",
			conditionRevision: "condition-v1",
			panelId: "panel",
			panelRevision: "v1",
			condition: "stale" as const,
			evidenceFingerprint: "outcome-evidence",
			evidenceRefs: signal.evidenceRefs,
			createdAtMs: 300,
		};
		await expect(
			authority.evaluateOccurrence(
				occurrence,
				completed,
				{ ...sub, policyRevision: "forged-policy" },
				signal,
				alert,
				null,
			),
		).resolves.toEqual({ accepted: false, code: "stale-subscription-revision" });
		const forgedSignal = {
			...signal,
			evidenceFingerprint: "forged-evidence",
			evidenceRefs: [{ kind: "executor-outcome", id: "forged-outcome" }],
		};
		await expect(
			authority.evaluateOccurrence(
				occurrence,
				completed,
				sub,
				forgedSignal,
				{
					...alert,
					evidenceFingerprint: forgedSignal.evidenceFingerprint,
					evidenceRefs: forgedSignal.evidenceRefs,
				},
				null,
			),
		).resolves.toEqual({ accepted: false, code: "evaluation-correlation-mismatch" });
		await expect(
			authority.evaluateOccurrence(occurrence, completed, sub, signal, alert, null),
		).resolves.toMatchObject({
			accepted: true,
			value: { state: "evaluated", evaluation: { alertId: "alert" } },
		});
		const viewGrant: SharedControlPanelGrant = {
			...grant,
			grantId: "view-grant",
			capability: "view",
			issuedAtMs: 300,
		};
		await persistence.issueGrantAtomically({ value: viewGrant, hostNowMs: 300 });
		const viewTruth = {
			...subscribeTruth(300),
			grantId: "view-grant",
			capability: "view" as const,
		};
		await persistence.projectAuthorizedRestrictedSnapshotAtomically({
			truth: viewTruth,
			hostNowMs: 300,
		});
		await persistence.projectAuthorizedRestrictedSnapshotAtomically({
			truth: viewTruth,
			hostNowMs: 300,
		});
		const projectionAudits = await persistence.readOrderedAudit({ tenantId: "tenant" });
		expect(
			projectionAudits.filter((entry) => entry.eventKind === "capability-admitted:view"),
		).toHaveLength(2);
		const delivery = {
			kind: "shared-control-panel-inbox-delivery" as const,
			deliveryId: "delivery",
			tenantId: "tenant",
			alertId: "alert",
			recipientId: "viewer",
			redactionRevision: "redaction",
			state: "pending" as const,
			createdAtMs: 300,
			deliveredAtMs: null,
			terminalAtMs: null,
		};
		await expect(
			persistence.createAuthorizedInboxDeliveryAtomically({
				value: delivery,
				truth: { ...viewTruth, subjectId: "other" },
				hostNowMs: 300,
			}),
		).resolves.toMatchObject({ accepted: false });
		await expect(
			persistence.createAuthorizedInboxDeliveryAtomically({
				value: delivery,
				truth: { ...viewTruth, pins: { ...viewTruth.pins, panelId: "other-panel" } },
				hostNowMs: 300,
			}),
		).resolves.toMatchObject({ accepted: false });
		await expect(
			persistence.createAuthorizedInboxDeliveryAtomically({
				value: delivery,
				truth: { ...viewTruth, currentRedactionRevision: "other" },
				hostNowMs: 300,
			}),
		).resolves.toMatchObject({ accepted: false });
		await persistence.createAuthorizedInboxDeliveryAtomically({
			value: delivery,
			truth: viewTruth,
			hostNowMs: 300,
		});
		await expect(
			persistence.transitionAuthorizedInboxDeliveryAtomically({
				deliveryId: "delivery",
				from: "pending",
				to: "delivered",
				truth: viewTruth,
				hostNowMs: 301,
			}),
		).resolves.toEqual({ accepted: false, code: "invalid-delivery-transition" });
		await persistence.transitionAuthorizedInboxDeliveryAtomically({
			deliveryId: "delivery",
			from: "pending",
			to: "attempted",
			truth: viewTruth,
			hostNowMs: 301,
		});
		const terminals = await Promise.all([
			persistence.transitionAuthorizedInboxDeliveryAtomically({
				deliveryId: "delivery",
				from: "attempted",
				to: "delivered",
				truth: viewTruth,
				hostNowMs: 302,
			}),
			persistence.transitionAuthorizedInboxDeliveryAtomically({
				deliveryId: "delivery",
				from: "attempted",
				to: "failed",
				truth: viewTruth,
				hostNowMs: 302,
			}),
		]);
		expect(terminals.filter((result) => result.accepted)).toHaveLength(1);
		expect(terminals.filter((result) => !result.accepted)).toHaveLength(1);
	});

	it("materializes an exact query rerun once under concurrency and appends one receipt audit", async () => {
		const persistence = await seedSubscriptionHost();
		const queryGrant: SharedControlPanelGrant = {
			...grant,
			grantId: "query-grant",
			capability: "query-rerun",
		};
		await persistence.issueGrantAtomically({ value: queryGrant, hostNowMs: 100 });
		const truth = {
			...subscribeTruth(100),
			grantId: "query-grant",
			capability: "query-rerun" as const,
		};
		const request = {
			kind: "shared-control-panel-query-rerun-request" as const,
			rerunId: "rerun",
			idempotencyKey: "rerun-key",
			truth,
			candidate: {
				kind: "shared-control-panel-run-candidate" as const,
				occurrenceId: "rerun",
				createdAtMs: 100,
				request: {
					kind: "tool-provider-adapter-run-requested" as const,
					runId: "fresh-run",
					adapterInputId: "adapter-input",
					requestId: "fresh-request",
					operationId: "operation",
					attempt: 1,
					reason: "shared-control-panel-query-rerun" as const,
					requestedAtMs: 100,
					metadata: {
						executionEnvironmentId: "environment",
						executionEnvironmentRevision: "environment-v1",
						executionEnvironmentLocality: "local",
						executionEnvironmentBindingKind: "local-host-process",
						executionSessionEpoch: "session:1",
					},
				},
			},
			binding: {
				tenantId: "tenant",
				workspaceId: "workspace",
				workGraphId: "graph",
				panelId: "panel",
				panelRevision: "v1",
				priorRequestId: "request",
				priorRunId: "run",
				priorOutcomeId: "outcome",
				queryRevision: "query",
				specRevision: "spec",
				inputRevision: "input",
				sourceRevision: "source",
				policyRevision: "policy",
			},
			requestedAtMs: 100,
		};
		await persistence.recordQueryRerunAtomically({ value: request, hostNowMs: 100 });
		const results = await Promise.all([
			persistence.materializeQueryRerunAtomically({ value: request, hostNowMs: 100 }),
			persistence.materializeQueryRerunAtomically({ value: request, hostNowMs: 100 }),
		]);
		expect(results.map((result) => result.code).sort()).toEqual([
			"query-rerun-materialized",
			"query-rerun-rereferenced",
		]);
		const audits = await persistence.readOrderedAudit({ tenantId: "tenant" });
		expect(audits.filter((entry) => entry.eventKind === "query-rerun-materialized")).toHaveLength(
			1,
		);
	});
});
