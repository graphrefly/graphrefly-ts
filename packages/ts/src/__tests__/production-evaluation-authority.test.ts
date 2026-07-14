import { describe, expect, it } from "vitest";
import {
	createProductionEvaluationAuthority,
	type ProductionEvaluationCampaignRevision,
	type ProductionMigrationActionProposal,
	type ProductionScenarioResult,
} from "../solutions/production-evaluation-authority.js";
import { createProductionEvaluationMemoryPersistence } from "../testing/production-evaluation-memory-persistence.js";

const ref = (id: string, revision = "r1") => ({ id, revision });
const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };
const candidate = {
	adapter: ref("adapter"),
	runtime: ref("runtime"),
	configurationFingerprint: "config-fingerprint",
};
const campaign = (
	at: number,
	revision = "campaign-r1",
	previousRevision: string | null = null,
): ProductionEvaluationCampaignRevision => ({
	kind: "production-evaluation-campaign-revision",
	campaignId: "campaign",
	revision,
	previousRevision,
	scope,
	candidate,
	scenarioPack: ref("pack", "pack-r1"),
	criteria: ref("criteria", "criteria-r1"),
	scenarios: [{ scenarioId: "scenario-a", revision: "scenario-r1", dependencyIds: [] }],
	environmentRefs: [ref("environment")],
	dataRefs: [ref("data")],
	sourceRefs: [ref("source")],
	schemaRefs: [ref("schema")],
	policyRefs: [ref("policy")],
	createdBy: "actor",
	createdAtMs: at,
});
const result = (at: number): ProductionScenarioResult => ({
	kind: "production-scenario-result",
	scope,
	campaignId: "campaign",
	campaignRevision: "campaign-r1",
	scenarioId: "scenario-a",
	scenarioRevision: "scenario-r1",
	resultId: "result-1",
	candidate,
	requestId: "request-1",
	admissionId: "run-admission-1",
	runId: "run-1",
	attempt: 1,
	outcomeId: 'postgresql-executor-outcome:["run:normal","1"]',
	evidenceId: "evidence-1",
	evidenceHighWater: 5,
	outcome: "succeeded",
	measurements: { correctness: 1 },
	evidenceRefs: [ref("evidence-1")],
	recordedAtMs: at,
});
const proposal = (at: number): ProductionMigrationActionProposal => ({
	kind: "production-migration-action-proposal",
	actionId: "action-1",
	actionKind: "cutover",
	generation: 1,
	fence: 1,
	idempotencyKey: "idem-1",
	pins: {
		scope,
		campaignId: "campaign",
		campaignRevision: "campaign-r1",
		source: { ...candidate, configurationFingerprint: "source-config" },
		target: candidate,
		trafficRefs: [ref("traffic")],
		dataRefs: [ref("data")],
		schemaRefs: [ref("schema")],
		policyRefs: [ref("policy")],
		credentialPostureRefs: [ref("credential-posture")],
		prerequisiteRefs: [ref("prerequisite")],
		attestationRef: ref("attestation-1", "policy-r1"),
		predecessorActionRefs: [],
		coexistenceEvidenceRefs: [ref("result-1", "scenario-r1")],
		rollbackPlan: ref("rollback-plan"),
		evidenceHighWater: 5,
	},
	requestedBy: "actor",
	requestedAtMs: at,
});
const attestation = (at: number) => ({
	kind: "production-attestation" as const,
	attestationId: "attestation-1",
	decisionId: "decision-1",
	idempotencyKey: "attestation-idem-1",
	scope,
	campaignId: "campaign",
	campaignRevision: "campaign-r1",
	candidate,
	posture: "production-admitted" as const,
	criteriaRevision: "criteria-r1",
	evidenceHighWater: 5,
	actorRef: ref("admitter"),
	admitterRef: ref("production-admitter"),
	reviewerRefs: [ref("security-review")],
	policyRevision: "policy-r1",
	reason: "externally-approved",
	auditRefs: [ref("external-audit")],
	issuedAtMs: at,
	expiresAtMs: at + 100,
	supersedesId: null,
	revokedAtMs: null,
});
const makeAuthority = (
	persistence: ReturnType<typeof createProductionEvaluationMemoryPersistence>,
	getNow: () => number,
) =>
	createProductionEvaluationAuthority({
		persistence,
		clock: { now: getNow },
		scenarioResultAuthority: {
			lookup: async (query) => {
				const v = result(getNow());
				return {
					requestId: query.requestId,
					admissionId: query.admissionId,
					runId: query.runId,
					attempt: query.attempt,
					outcomeId: query.outcomeId,
					evidenceId: query.evidenceId,
					outcome: v.outcome,
					candidate: v.candidate,
					evidenceHighWater: v.evidenceHighWater,
					currentEvidenceHighWater: v.evidenceHighWater,
					evidenceRefs: v.evidenceRefs,
				};
			},
		},
		migrationPrerequisiteAuthority: {
			lookup: async (v) => ({
				scope: v.pins.scope,
				campaignId: v.pins.campaignId,
				campaignRevision: v.pins.campaignRevision,
				candidate: v.pins.target,
				evidenceHighWater: v.pins.evidenceHighWater,
				attestationRef: v.pins.attestationRef,
				trafficRefs: v.pins.trafficRefs,
				dataRefs: v.pins.dataRefs,
				schemaRefs: v.pins.schemaRefs,
				policyRefs: v.pins.policyRefs,
				credentialPostureRefs: v.pins.credentialPostureRefs,
				prerequisiteRefs: v.pins.prerequisiteRefs,
				coexistenceEvidenceRefs: v.pins.coexistenceEvidenceRefs,
				predecessorActionRefs: v.pins.predecessorActionRefs,
				rollbackPlan: v.pins.rollbackPlan,
				policyRevision: "policy-r1",
				checkedAtMs: getNow(),
				expiresAtMs: getNow() + 100,
			}),
		},
		packetAdmissionAuthority: {
			lookup: async (v) => ({
				admissionId: v.admissionId,
				packetId: v.packetId,
				scope: v.scope,
				campaignId: v.campaignId,
				campaignRevision: v.campaignRevision,
				candidate: v.candidate,
				evidenceHighWater: v.evidenceHighWater,
				resultRefs: v.resultRefs,
				attestationRefs: v.attestationRefs,
				actionRefs: v.actionRefs,
				policyRevision: v.policyRevision,
				redactionRevision: v.redactionRevision,
				admittedAtMs: getNow(),
				expiresAtMs: getNow() + 100,
			}),
		},
		migrationOutcomeAuthority: {
			lookup: async (v) => ({
				actionId: v.actionId,
				admissionId: v.admissionId,
				materializationId: v.materializationId,
				actionKind: "cutover",
				generation: 1,
				fence: 1,
				executorRunId: v.executorRunId,
				providerRequestId: v.providerRequestId,
				providerAdmissionId: v.providerAdmissionId,
				providerOutcomeId: v.providerOutcomeId,
				providerEvidenceId: v.providerEvidenceId,
				providerAttempt: v.providerAttempt,
				sourceRefs: v.sourceRefs,
				state: "succeeded",
				evidenceRefs: [ref("migration-evidence")],
				terminalHighWater: 8,
			}),
		},
		attestationAdmissionAuthority: { lookup: async (value) => ({ attestation: value }) },
	});

describe("production evaluation authority", () => {
	it("persists immutable campaign/result and exact rereferences", async () => {
		let now = 100;
		const persistence = createProductionEvaluationMemoryPersistence();
		const authority = makeAuthority(persistence, () => now);
		expect((await authority.createCampaignRevision(campaign(now))).accepted).toBe(true);
		now = 101;
		const first = await authority.recordScenarioResult(result(now));
		expect(first).toMatchObject({ accepted: true, code: "created" });
		expect(Object.isFrozen(first)).toBe(true);
		if (first.accepted) expect(Object.isFrozen(first.value.evidenceRefs)).toBe(true);
		const again = await authority.recordScenarioResult(result(now));
		expect(again).toMatchObject({ accepted: true, code: "rereferenced" });
		expect(
			await authority.recordScenarioResult({ ...result(now), resultId: "result-conflict" }),
		).toMatchObject({ accepted: false, code: "conflict" });
		expect(
			await authority.recordScenarioResult({
				...result(now),
				requestId: "request-2",
				admissionId: "run-admission-2",
				runId: "run-2",
				outcomeId: "outcome-2",
				evidenceId: "evidence-2",
			}),
		).toMatchObject({ accepted: false, code: "conflict" });
		expect(await authority.readAudit("tenant-1")).toHaveLength(2);
	});

	it("uses host time and rejects caller time, mixed candidates, stale heads and accessors", async () => {
		let now = 100;
		const authority = makeAuthority(createProductionEvaluationMemoryPersistence(), () => now);
		expect(await authority.createCampaignRevision(campaign(99))).toMatchObject({
			accepted: false,
			code: "invalid",
		});
		expect((await authority.createCampaignRevision(campaign(now))).accepted).toBe(true);
		now = 101;
		expect(await authority.createCampaignRevision(campaign(now, "r2", "wrong"))).toMatchObject({
			accepted: false,
			code: "stale-head",
		});
		expect(
			await authority.recordScenarioResult({
				...result(now),
				candidate: { ...candidate, configurationFingerprint: "mixed" },
			}),
		).toMatchObject({ accepted: false, code: "correlation-mismatch" });
		let reads = 0;
		const malicious = {
			...result(now),
			get evidenceId() {
				reads++;
				return "e";
			},
		};
		await expect(authority.recordScenarioResult(malicious)).rejects.toThrow("accessor");
		expect(reads).toBe(0);
		await expect(
			authority.recordScenarioResult({
				...result(now),
				rawSql: "select secret",
			} as unknown as ProductionScenarioResult),
		).rejects.toThrow("kind");
		await expect(
			authority.recordScenarioResult({
				...result(now),
				outcome: "maybe",
			} as unknown as ProductionScenarioResult),
		).rejects.toThrow("scenario-outcome");
		await expect(
			authority.createCampaignRevision({
				...campaign(now, "cycle-r1", "campaign-r1"),
				scenarios: [
					{ scenarioId: "a", revision: "r1", dependencyIds: ["b"] },
					{ scenarioId: "b", revision: "r1", dependencyIds: ["a"] },
				],
			}),
		).rejects.toThrow("scenario-cycle");
	});

	it("enforces action proposal-admission-materialization-terminal ordering and fences", async () => {
		let now = 100;
		const persistence = createProductionEvaluationMemoryPersistence();
		const authority = makeAuthority(persistence, () => now);
		await authority.createCampaignRevision(campaign(now));
		now++;
		await authority.recordScenarioResult(result(now));
		now++;
		await authority.recordAttestation(attestation(now));
		now++;
		expect((await authority.proposeAction(proposal(now))).accepted).toBe(true);
		expect(
			await authority.proposeAction({
				...proposal(now),
				actionId: "stale",
				idempotencyKey: "stale",
			}),
		).toMatchObject({ accepted: false, code: "stale-fence" });
		now++;
		const admission = {
			kind: "production-migration-action-admission" as const,
			admissionId: "admission-1",
			scope,
			actionId: "action-1",
			actionKind: "cutover" as const,
			generation: 1,
			fence: 1,
			policyRevision: "policy-r1",
			admittedBy: "admitter",
			admittedAtMs: now,
			expiresAtMs: now + 100,
		};
		expect((await authority.admitAction(admission)).accepted).toBe(true);
		now++;
		const material = {
			kind: "production-migration-action-materialization" as const,
			materializationId: "material-1",
			scope,
			actionId: "action-1",
			admissionId: "admission-1",
			actionKind: "cutover" as const,
			generation: 1,
			fence: 1,
			executorRequestId: "request-1",
			materializedAtMs: now,
		};
		const [winner, loser] = await Promise.all([
			authority.materializeAction(material),
			authority.materializeAction({ ...material, materializationId: "material-race" }),
		]);
		expect(winner).toMatchObject({ accepted: true, code: "created" });
		expect(loser).toMatchObject({ accepted: false, code: "conflict" });
		expect(await authority.materializeAction(material)).toMatchObject({
			accepted: true,
			code: "rereferenced",
		});
		const handoff = {
			kind: "production-migration-execution-handoff-intent" as const,
			scope,
			actionId: "action-1",
			admissionId: "admission-1",
			materializationId: "material-1",
			executorRequestId: "request-1",
		};
		const lowered = await authority.lowerMaterializedActionExecution(handoff);
		expect(lowered).toMatchObject({
			accepted: true,
			code: "created",
			value: {
				kind: "production-migration-execution-request",
				campaignId: "campaign",
				campaignRevision: "campaign-r1",
				actionKind: "cutover",
				actionId: "action-1",
				admissionId: "admission-1",
				materializationId: "material-1",
				executorRequestId: "request-1",
				generation: 1,
				fence: 1,
				source: proposal(now).pins.source,
				target: candidate,
				evidenceHighWater: 5,
			},
		});
		expect(await authority.lowerMaterializedActionExecution(handoff)).toMatchObject({
			accepted: true,
			code: "rereferenced",
		});
		expect(
			await authority.lowerMaterializedActionExecution({
				...handoff,
				executorRequestId: "forged-request",
			}),
		).toMatchObject({ accepted: false, code: "correlation-mismatch" });
		expect(
			await authority.lowerMaterializedActionExecution({
				...handoff,
				materializationId: "missing",
			}),
		).toMatchObject({ accepted: false, code: "not-found" });
		const sourceRefs = [{ kind: "postgresql-execution", id: "request-1" }] as const;
		const binding = {
			kind: "production-migration-execution-binding" as const,
			scope,
			campaignId: "campaign",
			campaignRevision: "campaign-r1",
			actionKind: "cutover" as const,
			actionId: "action-1",
			admissionId: "admission-1",
			materializationId: "material-1",
			executorRequestId: "request-1",
			generation: 1,
			fence: 1,
			providerRequestId: "provider-request-1",
			providerAdmissionId: "provider-admission-1",
			providerRunId: "run-2",
			providerAttempt: 1,
			sourceRefs,
			boundAtMs: now,
		};
		expect(await authority.recordMigrationExecutionBinding(binding)).toMatchObject({
			accepted: true,
			code: "created",
		});
		expect(await authority.recordMigrationExecutionBinding(binding)).toMatchObject({
			accepted: true,
			code: "rereferenced",
		});
		expect(
			await authority.recordMigrationExecutionBinding({
				...binding,
				providerRunId: "forged-run",
			}),
		).toMatchObject({ accepted: false, code: "conflict" });
		expect(
			await authority.recordMigrationExecutionBinding({
				...binding,
				materializationId: "missing",
			}),
		).toMatchObject({ accepted: false, code: "correlation-mismatch" });
		expect(
			await authority.recordActionOutcome({
				kind: "production-migration-action-outcome",
				outcomeId: "terminal-before-settlement",
				scope,
				actionId: "action-1",
				admissionId: "admission-1",
				materializationId: "material-1",
				actionKind: "cutover",
				generation: 1,
				fence: 1,
				executorRunId: "run-2",
				providerRequestId: "provider-request-1",
				providerAdmissionId: "provider-admission-1",
				providerOutcomeId: "provider-outcome-1",
				providerEvidenceId: "provider-evidence-1",
				providerAttempt: 1,
				sourceRefs,
				state: "succeeded",
				evidenceRefs: [ref("migration-evidence")],
				terminalHighWater: 8,
				recordedAtMs: now,
			}),
		).toMatchObject({ accepted: false, code: "not-found" });
		const settlement = {
			kind: "production-migration-execution-settlement" as const,
			scope,
			executorRequestId: "request-1",
			providerRequestId: "provider-request-1",
			providerAdmissionId: "provider-admission-1",
			providerRunId: "run-2",
			providerAttempt: 1,
			providerOutcomeId: "provider-outcome-1",
			providerEvidenceId: "provider-evidence-1",
			providerEvidenceHighWater: 8,
			sourceRefs,
			settledAtMs: now,
		};
		expect(await authority.settleMigrationExecutionBinding(settlement)).toMatchObject({
			accepted: true,
			code: "created",
		});
		expect(await authority.settleMigrationExecutionBinding(settlement)).toMatchObject({
			accepted: true,
			code: "rereferenced",
		});
		expect(
			await authority.settleMigrationExecutionBinding({
				...settlement,
				providerOutcomeId: "forged-outcome",
			}),
		).toMatchObject({ accepted: false, code: "conflict" });
		now++;
		expect(
			await authority.proposeAction({
				...proposal(now),
				actionId: "action-2",
				fence: 2,
				idempotencyKey: "idem-2",
			}),
		).toMatchObject({ accepted: true });
		expect(await authority.lowerMaterializedActionExecution(handoff)).toMatchObject({
			accepted: false,
			code: "stale-fence",
		});
		now++;
		await authority.revokeAttestation("tenant-1", "attestation-1");
		now = 250;
		const outcome = {
			kind: "production-migration-action-outcome" as const,
			outcomeId: "terminal-1",
			scope,
			actionId: "action-1",
			admissionId: "admission-1",
			materializationId: "material-1",
			actionKind: "cutover" as const,
			generation: 1,
			fence: 1,
			executorRunId: "run-2",
			providerRequestId: "provider-request-1",
			providerAdmissionId: "provider-admission-1",
			providerOutcomeId: "provider-outcome-1",
			providerEvidenceId: "provider-evidence-1",
			providerAttempt: 1,
			sourceRefs,
			state: "succeeded" as const,
			evidenceRefs: [ref("migration-evidence")],
			terminalHighWater: 8,
			recordedAtMs: now,
		};
		expect((await authority.recordActionOutcome(outcome)).accepted).toBe(true);
		expect(await authority.recordActionOutcome({ ...outcome, state: "failed" })).toMatchObject({
			accepted: false,
			code: "correlation-mismatch",
		});
		now++;
		const before = (await authority.readAudit("tenant-1")).length;
		expect(
			await authority.admitAction({
				...admission,
				admissionId: "late-admission",
				admittedAtMs: now,
				expiresAtMs: now + 100,
			}),
		).toMatchObject({ accepted: false, code: "stale-fence" });
		expect(await authority.readAudit("tenant-1")).toHaveLength(before);
	});

	it("keeps external attestations append-only and revokes with host time", async () => {
		let now = 100;
		const authority = makeAuthority(createProductionEvaluationMemoryPersistence(), () => now);
		await authority.createCampaignRevision(campaign(now));
		now++;
		await authority.recordScenarioResult(result(now));
		now++;
		const value = attestation(now);
		expect(await authority.recordAttestation(value)).toMatchObject({ accepted: true });
		expect(await authority.recordAttestation({ ...value, reason: "different" })).toMatchObject({
			accepted: false,
			code: "conflict",
		});
		expect(
			await authority.recordAttestation({
				...value,
				attestationId: "attestation-2",
				decisionId: "decision-2",
			}),
		).toMatchObject({ accepted: false, code: "conflict" });
		now++;
		expect(await authority.revokeAttestation("tenant-1", "attestation-1")).toMatchObject({
			accepted: true,
			code: "advanced",
			value: { revokedAtMs: now },
		});
		expect(await authority.revokeAttestation("tenant-1", "attestation-1")).toMatchObject({
			accepted: true,
			code: "rereferenced",
		});
	});

	it("appends a DTO-only packet manifest by exact campaign and candidate", async () => {
		let now = 100;
		const authority = makeAuthority(createProductionEvaluationMemoryPersistence(), () => now);
		await authority.createCampaignRevision(campaign(now));
		now++;
		await authority.recordScenarioResult(result(now));
		now++;
		await authority.recordAttestation(attestation(now));
		now++;
		const packet = {
			kind: "production-evidence-packet-manifest" as const,
			packetId: "packet-1",
			scope,
			campaignId: "campaign",
			campaignRevision: "campaign-r1",
			candidate,
			evidenceHighWater: 5,
			resultRefs: [ref("result-1", "scenario-r1")],
			attestationRefs: [ref("attestation-1", "policy-r1")],
			actionRefs: [],
			manifestRevision: "manifest-r1",
			admissionId: "packet-admission-1",
			policyRevision: "packet-policy-r1",
			redactionRevision: "redaction-r1",
			createdBy: "actor",
			createdAtMs: now,
		};
		expect(await authority.recordPacketManifest(packet)).toMatchObject({
			accepted: true,
			code: "created",
		});
		expect(await authority.recordPacketManifest(packet)).toMatchObject({
			accepted: true,
			code: "rereferenced",
		});
		expect(
			await authority.recordPacketManifest({
				...packet,
				packetId: "packet-mixed",
				candidate: { ...candidate, configurationFingerprint: "mixed" },
			}),
		).toMatchObject({ accepted: false, code: "correlation-mismatch" });
		const before = (await authority.readAudit("tenant-1")).length;
		expect(
			await authority.recordPacketManifest({
				...packet,
				packetId: "packet-forged",
				admissionId: "packet-admission-2",
				resultRefs: [ref("missing", "scenario-r1")],
			}),
		).toMatchObject({ accepted: false, code: "ineligible" });
		expect(await authority.readAudit("tenant-1")).toHaveLength(before);
	});

	it("rejects accessor-bearing canonical authority output before persistence", async () => {
		let reads = 0;
		const persistence = createProductionEvaluationMemoryPersistence();
		let now = 100;
		const base = makeAuthority(persistence, () => now);
		await base.createCampaignRevision(campaign(now));
		now++;
		const authority = createProductionEvaluationAuthority({
			persistence,
			clock: { now: () => now },
			scenarioResultAuthority: {
				lookup: async () => ({
					requestId: "request-1",
					admissionId: "run-admission-1",
					runId: "run-1",
					attempt: 1,
					outcomeId: 'postgresql-executor-outcome:["run:normal","1"]',
					get evidenceId() {
						reads++;
						return "evidence-1";
					},
					outcome: "succeeded",
					candidate,
					evidenceHighWater: 5,
					currentEvidenceHighWater: 5,
					evidenceRefs: [ref("evidence-1")],
				}),
			},
			migrationPrerequisiteAuthority: { lookup: async () => null },
			packetAdmissionAuthority: { lookup: async () => null },
			migrationOutcomeAuthority: { lookup: async () => null },
			attestationAdmissionAuthority: { lookup: async () => null },
		});
		await expect(authority.recordScenarioResult(result(now))).rejects.toThrow("accessor");
		expect(reads).toBe(0);
		expect(await authority.recordAttestation(attestation(now))).toMatchObject({
			accepted: false,
			code: "correlation-mismatch",
		});
		expect(await authority.readAudit("tenant-1")).toHaveLength(1);
	});

	it("rolls back an injected atomic commit failure", async () => {
		const persistence = createProductionEvaluationMemoryPersistence();
		const authority = makeAuthority(persistence, () => 100);
		persistence.failNextCommit();
		await expect(authority.createCampaignRevision(campaign(100))).rejects.toThrow("commit-failed");
		expect((await authority.createCampaignRevision(campaign(100))).accepted).toBe(true);
	});
});
