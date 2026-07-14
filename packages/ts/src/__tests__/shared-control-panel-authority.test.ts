import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
	createSharedControlPanelAuthority,
	type SharedControlPanelPersistencePort,
} from "../solutions/shared-control-panel-authority.js";
import type {
	SharedControlPanelCanonicalTruth,
	SharedControlPanelRecordedTerminalOutcome,
	SharedControlPanelStoreResult,
	SharedControlPanelSubscriptionRevision,
} from "../solutions/shared-control-panel-contracts.js";
import { sharedControlPanelAdmissionFingerprint } from "../solutions/shared-control-panel-contracts.js";

const pins = {
	tenantId: "tenant",
	workspaceId: "workspace",
	workGraphId: "graph",
	panelId: "panel",
	panelRevision: "panel-v1",
	queryRevision: "query-v1",
	specRevision: "spec-v1",
	sourceRevision: "source-v1",
	schemaRevision: "schema-v1",
	artifactRevision: "artifact-v1",
	inputRevision: "input-v1",
	topologyFingerprint: "topology-v1",
	policyRevision: "policy-v1",
	redactionRevision: "redaction-v1",
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
const truth: SharedControlPanelCanonicalTruth = {
	kind: "shared-control-panel-canonical-truth",
	pins,
	recordedAtMs: 100,
};

function recordingPort(calls: unknown[]): SharedControlPanelPersistencePort {
	return new Proxy(
		{},
		{
			get: (target, property) =>
				property in target
					? Reflect.get(target, property)
					: async (command: unknown) => {
							calls.push({ property, command });
							if (property === "readAdmissionForTerminalOutcome") return null;
							if (property === "readOrderedAudit") return [];
							const material = command as {
								value?: unknown;
								truth?: unknown;
								request?: { revision: unknown };
								occurrence?: unknown;
							};
							const value =
								material.value ??
								material.request?.revision ??
								material.occurrence ??
								material.truth;
							return {
								accepted: true,
								code: "recorded",
								value,
							} satisfies SharedControlPanelStoreResult<unknown>;
						},
		},
	) as SharedControlPanelPersistencePort;
}

describe("D609 database-neutral shared control-panel authority facade", () => {
	it("passes a frozen strict snapshot and host-owned time to the feature port", async () => {
		const calls: unknown[] = [];
		const authority = createSharedControlPanelAuthority({
			persistence: recordingPort(calls),
			clock: { now: () => 100 },
			terminalOutcomeAuthority: { lookup: vi.fn(async () => null) },
			subscriptionBindingAuthority: { lookup: vi.fn(async () => null) },
		});
		await expect(authority.recordCanonicalTruth(truth)).resolves.toEqual({
			accepted: true,
			code: "recorded",
			value: truth,
		});
		const command = (calls[0] as { command: { value: unknown; hostNowMs: number } }).command;
		expect(command.hostNowMs).toBe(100);
		expect(command.value).toEqual(truth);
		expect(Object.isFrozen(command)).toBe(true);
		expect(Object.isFrozen(command.value)).toBe(true);
	});

	it("rejects accessors before invoking persistence and rejects malformed port results", async () => {
		const calls: unknown[] = [];
		const authority = createSharedControlPanelAuthority({
			persistence: recordingPort(calls),
			clock: { now: () => 100 },
			terminalOutcomeAuthority: { lookup: vi.fn(async () => null) },
			subscriptionBindingAuthority: { lookup: vi.fn(async () => null) },
		});
		const accessor = { ...truth };
		Object.defineProperty(accessor, "pins", { enumerable: true, get: () => pins });
		await expect(authority.recordCanonicalTruth(accessor)).rejects.toThrow(
			"accessor-shared-control-panel-material",
		);
		expect(calls).toHaveLength(0);
		const malformed = recordingPort([]);
		malformed.recordCanonicalTruthAtomically = vi.fn(async () => ({
			accepted: false,
			code: "no",
			value: truth,
		}));
		const malformedAuthority = createSharedControlPanelAuthority({
			persistence: malformed,
			clock: { now: () => 100 },
			terminalOutcomeAuthority: { lookup: vi.fn(async () => null) },
			subscriptionBindingAuthority: { lookup: vi.fn(async () => null) },
		});
		await expect(malformedAuthority.recordCanonicalTruth(truth)).rejects.toThrow(
			"unknown-shared-control-panel-persistence-result-field",
		);
	});

	it("resolves the stored admission and host-verifies terminal evidence before persistence", async () => {
		const calls: unknown[] = [];
		const admission = {
			kind: "tool-provider-run-admission" as const,
			admissionId: "admission",
			proposalId: "proposal",
			runId: "candidate-run",
			adapterInputId: "adapter-input",
			requestId: "candidate-request",
			operationId: "operation",
			state: "admitted" as const,
			decisionId: "decision",
			approvedRunId: "approved-run",
		};
		const recordedAdmission = {
			kind: "shared-control-panel-recorded-admission" as const,
			tenantId: "tenant",
			occurrenceId: "occurrence",
			admission,
			bodyFingerprint: sharedControlPanelAdmissionFingerprint(admission),
			recordedAtMs: 100,
		};
		const port = recordingPort(calls);
		port.readAdmissionForTerminalOutcome = vi.fn(async () => recordedAdmission);
		const verified = {
			runId: "approved-run",
			attempt: 1,
			outcomeId: "outcome",
			terminalHighWater: 2,
			outcomeEvidenceFingerprint: "evidence-fingerprint",
			evidenceRefs: [{ kind: "executor-outcome", id: "outcome" }],
		};
		const lookup = vi.fn(async () => verified);
		const authority = createSharedControlPanelAuthority({
			persistence: port,
			clock: { now: () => 100 },
			terminalOutcomeAuthority: { lookup },
			subscriptionBindingAuthority: { lookup: vi.fn(async () => null) },
		});
		const outcome: SharedControlPanelRecordedTerminalOutcome = {
			kind: "shared-control-panel-recorded-terminal-outcome",
			tenantId: "tenant",
			occurrenceId: "occurrence",
			runId: verified.runId,
			attempt: verified.attempt,
			outcomeId: verified.outcomeId,
			terminalHighWater: verified.terminalHighWater,
			outcomeEvidenceFingerprint: verified.outcomeEvidenceFingerprint,
			evidenceRefs: verified.evidenceRefs,
			recordedAtMs: 100,
		};
		await expect(authority.recordTerminalOutcome(outcome)).resolves.toMatchObject({
			accepted: true,
			value: outcome,
		});
		expect(lookup).toHaveBeenCalledWith({
			tenantId: "tenant",
			occurrenceId: "occurrence",
			admissionId: "admission",
			approvedRunId: "approved-run",
		});
		const persisted = calls.find(
			(entry) =>
				(entry as { property: PropertyKey }).property === "recordVerifiedTerminalOutcomeAtomically",
		) as { command: { verified: unknown; hostNowMs: number } };
		expect(persisted.command).toMatchObject({ verified, hostNowMs: 100 });
		expect(Object.isFrozen(persisted.command)).toBe(true);
		verified.outcomeId = "mutated-after-return";
		expect(persisted.command.verified).toMatchObject({ outcomeId: "outcome" });

		let indexedGetterCalls = 0;
		const hostileRefs: unknown[] = [];
		Object.defineProperty(hostileRefs, 0, {
			enumerable: true,
			get: () => {
				indexedGetterCalls++;
				throw new Error("must-not-read-indexed-getter");
			},
		});
		hostileRefs.length = 1;
		const hostileAuthority = createSharedControlPanelAuthority({
			persistence: port,
			clock: { now: () => 100 },
			terminalOutcomeAuthority: {
				lookup: vi.fn(
					async () => ({ ...verified, outcomeId: "outcome", evidenceRefs: hostileRefs }) as never,
				),
			},
			subscriptionBindingAuthority: { lookup: vi.fn(async () => null) },
		});
		await expect(hostileAuthority.recordTerminalOutcome(outcome)).rejects.toThrow(
			"accessor-shared-control-panel-material",
		);
		expect(indexedGetterCalls).toBe(0);
		const writesBeforeOversized = calls.filter(
			(entry) =>
				(entry as { property: PropertyKey }).property === "recordVerifiedTerminalOutcomeAtomically",
		).length;
		const oversizedAuthority = createSharedControlPanelAuthority({
			persistence: port,
			clock: { now: () => 100 },
			terminalOutcomeAuthority: {
				lookup: vi.fn(async () => ({
					...verified,
					outcomeId: "outcome",
					evidenceRefs: Array.from({ length: 33 }, (_, index) => ({
						kind: "executor-outcome",
						id: `outcome-${index}`,
					})),
				})),
			},
			subscriptionBindingAuthority: { lookup: vi.fn(async () => null) },
		});
		await expect(oversizedAuthority.recordTerminalOutcome(outcome)).rejects.toThrow(
			"invalid-verified-terminal-outcome",
		);
		expect(
			calls.filter(
				(entry) =>
					(entry as { property: PropertyKey }).property ===
					"recordVerifiedTerminalOutcomeAtomically",
			).length,
		).toBe(writesBeforeOversized);
	});

	it("rejects an incoherent occurrence returned by a malicious persistence port", async () => {
		const port = recordingPort([]);
		port.claimDueOccurrenceAtomically = vi.fn(
			async () =>
				({
					accepted: true,
					code: "occurrence-claimed",
					value: {
						kind: "shared-control-panel-occurrence",
						tenantId: "tenant",
						occurrenceId: "occurrence",
						subscriptionId: "subscription",
						subscriptionRevision: "sub-v1",
						conditionRevision: "condition-v1",
						panelId: "panel",
						panelRevision: "panel-v1",
						dueAtMs: 100,
						claimedAtMs: 100,
						admissionFingerprint: "evidence",
						state: "claimed",
						reason: "due",
						candidate: { kind: "forged-candidate" },
						completed: null,
						evaluation: null,
					},
				}) as never,
		);
		const authority = createSharedControlPanelAuthority({
			persistence: port,
			clock: { now: () => 100 },
			terminalOutcomeAuthority: { lookup: vi.fn(async () => null) },
			subscriptionBindingAuthority: { lookup: vi.fn(async () => null) },
		});
		const subscription: SharedControlPanelSubscriptionRevision = {
			kind: "shared-control-panel-subscription-revision",
			tenantId: "tenant",
			subscriptionId: "subscription",
			subscriptionRevision: "sub-v1",
			previousRevision: null,
			panelId: "panel",
			panelRevision: "panel-v1",
			subjectId: "viewer",
			pins,
			grantId: "grant",
			capabilityRevision: "cap-v1",
			actorSessionRevision: "session-v1",
			intervalMs: 60_000,
			scheduleAnchorMs: 100,
			expiresAtMs: 1_000_000,
			condition: "stale",
			conditionRevision: "condition-v1",
			staleAfterMs: 60_000,
			anomalyThreshold: 1,
			cooldownMs: 60_000,
			rateCap: 1,
			policyRevision: "policy-v1",
			redactionRevision: "redaction-v1",
			active: true,
			effectiveAtMs: 100,
		};
		await expect(authority.claimDue(subscription, "occurrence", 100, "evidence")).rejects.toThrow();
	});

	it("rejects non-host write times and unsupported capabilities before persistence", async () => {
		const calls: unknown[] = [];
		const authority = createSharedControlPanelAuthority({
			persistence: recordingPort(calls),
			clock: { now: () => 100 },
			terminalOutcomeAuthority: { lookup: vi.fn(async () => null) },
			subscriptionBindingAuthority: { lookup: vi.fn(async () => null) },
		});
		await expect(authority.recordCanonicalTruth({ ...truth, recordedAtMs: 101 })).resolves.toEqual({
			accepted: false,
			code: "non-host-truth-time",
		});
		const unsupported = {
			kind: "shared-control-panel-grant" as const,
			grantId: "grant",
			tenantId: "tenant",
			panelId: "panel",
			panelRevision: "panel-v1",
			subjectId: "viewer",
			capability: "download" as const,
			capabilityRevision: "cap-v1",
			policyRevision: "policy-v1",
			redactionRevision: "redaction-v1",
			issuedAtMs: 100,
			expiresAtMs: 1000,
			revokedAtMs: null,
			actorSessionRevision: "session-v1",
		};
		await expect(authority.issueGrant(unsupported)).resolves.toEqual({
			accepted: false,
			code: "capability-unsupported-v1",
		});
		const unsupportedTruth = {
			kind: "shared-control-panel-current-truth" as const,
			pins,
			subjectId: "viewer",
			grantId: "grant",
			capability: "action" as const,
			capabilityRevision: "cap-v1",
			currentPolicyRevision: "policy-v1",
			currentRedactionRevision: "redaction-v1",
			actorSessionRevision: "session-v1",
			observedAtMs: 100,
		};
		await expect(authority.authorize(unsupportedTruth)).resolves.toEqual({
			accepted: false,
			code: "capability-unsupported-v1",
		});
		await expect(
			authority.projectRestricted({ ...unsupportedTruth, capability: "input" }),
		).resolves.toEqual({ accepted: false, code: "capability-unsupported-v1" });
		expect(calls).toHaveLength(0);
	});

	it("derives revocation time exclusively from the host clock and exposes no caller-time slot", async () => {
		const calls: unknown[] = [];
		const port = recordingPort(calls);
		port.revokeGrantAtomically = vi.fn(async (command) => ({
			accepted: true,
			code: "grant-revoked",
			value: {
				kind: "shared-control-panel-grant" as const,
				grantId: command.grantId,
				tenantId: command.tenantId,
				panelId: "panel",
				panelRevision: "panel-v1",
				subjectId: "viewer",
				capability: "view" as const,
				capabilityRevision: "cap-v1",
				policyRevision: "policy-v1",
				redactionRevision: "redaction-v1",
				issuedAtMs: 50,
				expiresAtMs: 1_000,
				revokedAtMs: command.revokedAtMs,
				actorSessionRevision: "session-v1",
			},
		}));
		const authority = createSharedControlPanelAuthority({
			persistence: port,
			clock: { now: () => 100 },
			terminalOutcomeAuthority: { lookup: vi.fn(async () => null) },
			subscriptionBindingAuthority: { lookup: vi.fn(async () => null) },
		});
		expectTypeOf(authority.revokeGrant).parameters.toEqualTypeOf<[string, string]>();
		await authority.revokeGrant("tenant", "grant");
		expect(port.revokeGrantAtomically).toHaveBeenCalledWith({
			tenantId: "tenant",
			grantId: "grant",
			revokedAtMs: 100,
			hostNowMs: 100,
		});
	});
});
