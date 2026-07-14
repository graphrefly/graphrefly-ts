/** Host-injected production evaluation and migration persistence authority (D610). */
import type {
	ProductionAttestation,
	ProductionAttestationAdmissionAuthority,
	ProductionEvaluationAuditEntry,
	ProductionEvaluationCampaignRevision,
	ProductionEvaluationHostClock,
	ProductionEvaluationStoreResult,
	ProductionEvidencePacketAdmissionAuthority,
	ProductionEvidencePacketManifest,
	ProductionMigrationActionAdmission,
	ProductionMigrationActionMaterialization,
	ProductionMigrationActionOutcome,
	ProductionMigrationActionProposal,
	ProductionMigrationExecutionBinding,
	ProductionMigrationExecutionHandoffIntent,
	ProductionMigrationExecutionRequest,
	ProductionMigrationExecutionSettlement,
	ProductionMigrationOutcomeAuthority,
	ProductionMigrationPrerequisiteAuthority,
	ProductionScenarioResult,
	ProductionScenarioResultAuthority,
	ProductionVerifiedAttestationAdmission,
	ProductionVerifiedEvidencePacketAdmission,
	ProductionVerifiedMigrationOutcome,
	ProductionVerifiedMigrationPrerequisites,
	ProductionVerifiedScenarioExecution,
} from "./production-evaluation-contracts.js";
import {
	productionEvaluationCanonical,
	productionEvaluationSnapshot,
	validateProductionEvaluationValue,
} from "./production-evaluation-contracts.js";

export type * from "./production-evaluation-contracts.js";
export { sameProductionCandidate } from "./production-evaluation-contracts.js";
export const PRODUCTION_EVALUATION_AUTHORITY_COMPATIBILITY =
	"production-evaluation-authority-v1" as const;

type Timed<T> = Readonly<{ value: T; hostNowMs: number }>;
export interface ProductionEvaluationPersistencePort {
	createCampaignRevisionAndAdvanceHeadAtomically(
		command: Timed<ProductionEvaluationCampaignRevision>,
	): Promise<ProductionEvaluationStoreResult<ProductionEvaluationCampaignRevision>>;
	appendScenarioResultAtomically(
		command: Timed<ProductionScenarioResult> &
			Readonly<{ verified: ProductionVerifiedScenarioExecution }>,
	): Promise<ProductionEvaluationStoreResult<ProductionScenarioResult>>;
	appendAttestationAtomically(
		command: Timed<ProductionAttestation> &
			Readonly<{ verified: ProductionVerifiedAttestationAdmission }>,
	): Promise<ProductionEvaluationStoreResult<ProductionAttestation>>;
	revokeAttestationAtomically(
		command: Readonly<{ tenantId: string; attestationId: string; hostNowMs: number }>,
	): Promise<ProductionEvaluationStoreResult<ProductionAttestation>>;
	appendActionProposalAndAdvanceFenceAtomically(
		command: Timed<ProductionMigrationActionProposal> &
			Readonly<{ verified: ProductionVerifiedMigrationPrerequisites }>,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationActionProposal>>;
	appendActionAdmissionAtomically(
		command: Timed<ProductionMigrationActionAdmission>,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationActionAdmission>>;
	materializeAdmittedActionAtomically(
		command: Timed<ProductionMigrationActionMaterialization>,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationActionMaterialization>>;
	lowerMaterializedActionExecutionAtomically(
		command: Timed<ProductionMigrationExecutionHandoffIntent>,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationExecutionRequest>>;
	recordMigrationExecutionBindingAtomically(
		command: Timed<ProductionMigrationExecutionBinding>,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationExecutionBinding>>;
	settleMigrationExecutionBindingAtomically(
		command: Timed<ProductionMigrationExecutionSettlement>,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationExecutionSettlement>>;
	appendActionTerminalOutcomeAtomically(
		command: Timed<ProductionMigrationActionOutcome> &
			Readonly<{ verified: ProductionVerifiedMigrationOutcome }>,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationActionOutcome>>;
	appendEvidencePacketManifestAtomically(
		command: Timed<ProductionEvidencePacketManifest> &
			Readonly<{ verified: ProductionVerifiedEvidencePacketAdmission }>,
	): Promise<ProductionEvaluationStoreResult<ProductionEvidencePacketManifest>>;
	readOrderedAudit(
		command: Readonly<{ tenantId: string }>,
	): Promise<readonly ProductionEvaluationAuditEntry[]>;
}
export interface ProductionEvaluationAuthorityOptions {
	readonly persistence: ProductionEvaluationPersistencePort;
	readonly clock: ProductionEvaluationHostClock;
	readonly scenarioResultAuthority: ProductionScenarioResultAuthority;
	readonly migrationPrerequisiteAuthority: ProductionMigrationPrerequisiteAuthority;
	readonly packetAdmissionAuthority: ProductionEvidencePacketAdmissionAuthority;
	readonly migrationOutcomeAuthority: ProductionMigrationOutcomeAuthority;
	readonly attestationAdmissionAuthority: ProductionAttestationAdmissionAuthority;
}
export interface ProductionEvaluationAuthority {
	readonly compatibility: typeof PRODUCTION_EVALUATION_AUTHORITY_COMPATIBILITY;
	createCampaignRevision(
		value: ProductionEvaluationCampaignRevision,
	): Promise<ProductionEvaluationStoreResult<ProductionEvaluationCampaignRevision>>;
	recordScenarioResult(
		value: ProductionScenarioResult,
	): Promise<ProductionEvaluationStoreResult<ProductionScenarioResult>>;
	recordAttestation(
		value: ProductionAttestation,
	): Promise<ProductionEvaluationStoreResult<ProductionAttestation>>;
	revokeAttestation(
		tenantId: string,
		attestationId: string,
	): Promise<ProductionEvaluationStoreResult<ProductionAttestation>>;
	proposeAction(
		value: ProductionMigrationActionProposal,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationActionProposal>>;
	admitAction(
		value: ProductionMigrationActionAdmission,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationActionAdmission>>;
	materializeAction(
		value: ProductionMigrationActionMaterialization,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationActionMaterialization>>;
	lowerMaterializedActionExecution(
		value: ProductionMigrationExecutionHandoffIntent,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationExecutionRequest>>;
	recordMigrationExecutionBinding(
		value: ProductionMigrationExecutionBinding,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationExecutionBinding>>;
	settleMigrationExecutionBinding(
		value: ProductionMigrationExecutionSettlement,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationExecutionSettlement>>;
	recordActionOutcome(
		value: ProductionMigrationActionOutcome,
	): Promise<ProductionEvaluationStoreResult<ProductionMigrationActionOutcome>>;
	recordPacketManifest(
		value: ProductionEvidencePacketManifest,
	): Promise<ProductionEvaluationStoreResult<ProductionEvidencePacketManifest>>;
	readAudit(tenantId: string): Promise<readonly ProductionEvaluationAuditEntry[]>;
}
const kinds = {
	campaign: "production-evaluation-campaign-revision",
	result: "production-scenario-result",
	attestation: "production-attestation",
	proposal: "production-migration-action-proposal",
	admission: "production-migration-action-admission",
	materialization: "production-migration-action-materialization",
	handoff: "production-migration-execution-handoff-intent",
	binding: "production-migration-execution-binding",
	settlement: "production-migration-execution-settlement",
	outcome: "production-migration-action-outcome",
	packet: "production-evidence-packet-manifest",
} as const;
export function createProductionEvaluationAuthority(
	options: ProductionEvaluationAuthorityOptions,
): ProductionEvaluationAuthority {
	const {
		persistence,
		clock,
		scenarioResultAuthority,
		migrationPrerequisiteAuthority,
		packetAdmissionAuthority,
		migrationOutcomeAuthority,
		attestationAdmissionAuthority,
	} = options;
	if (
		!persistence ||
		!clock ||
		typeof clock.now !== "function" ||
		!scenarioResultAuthority ||
		!migrationPrerequisiteAuthority ||
		!packetAdmissionAuthority ||
		!migrationOutcomeAuthority ||
		!attestationAdmissionAuthority
	)
		throw new TypeError("production-evaluation-authority-options-invalid");
	const now = () => {
		const value = clock.now();
		if (!Number.isSafeInteger(value) || value < 0)
			throw new TypeError("production-evaluation-host-clock-invalid");
		return value;
	};
	const checked = <T>(value: T, kind: string) =>
		validateProductionEvaluationValue(value, kind) as T;
	const safe = async <T>(operation: Promise<T>): Promise<Readonly<T>> =>
		productionEvaluationSnapshot(await operation);
	const equal = (a: unknown, b: unknown) =>
		productionEvaluationCanonical(a) === productionEvaluationCanonical(b);
	const authority: ProductionEvaluationAuthority = Object.freeze({
		compatibility: PRODUCTION_EVALUATION_AUTHORITY_COMPATIBILITY,
		createCampaignRevision: async (v: ProductionEvaluationCampaignRevision) =>
			safe(
				persistence.createCampaignRevisionAndAdvanceHeadAtomically({
					value: checked(v, kinds.campaign),
					hostNowMs: now(),
				}),
			),
		recordScenarioResult: async (v: ProductionScenarioResult) => {
			const value = checked(v, kinds.result);
			const hostNowMs = now();
			const verified = productionEvaluationSnapshot(
				await scenarioResultAuthority.lookup({
					scope: value.scope,
					campaignId: value.campaignId,
					campaignRevision: value.campaignRevision,
					scenarioId: value.scenarioId,
					scenarioRevision: value.scenarioRevision,
					requestId: value.requestId,
					admissionId: value.admissionId,
					runId: value.runId,
					attempt: value.attempt,
					outcomeId: value.outcomeId,
					evidenceId: value.evidenceId,
				}),
			);
			if (
				!verified ||
				!equal(verified, {
					requestId: value.requestId,
					admissionId: value.admissionId,
					runId: value.runId,
					attempt: value.attempt,
					outcomeId: value.outcomeId,
					evidenceId: value.evidenceId,
					outcome: value.outcome,
					candidate: value.candidate,
					evidenceHighWater: value.evidenceHighWater,
					currentEvidenceHighWater: value.evidenceHighWater,
					evidenceRefs: value.evidenceRefs,
				})
			)
				return Object.freeze({ accepted: false, code: "correlation-mismatch", value: null });
			return safe(
				persistence.appendScenarioResultAtomically({
					value,
					verified,
					hostNowMs,
				}),
			);
		},
		recordAttestation: async (v: ProductionAttestation) => {
			const value = checked(v, kinds.attestation);
			const hostNowMs = now();
			const verified = productionEvaluationSnapshot(
				await attestationAdmissionAuthority.lookup(value),
			);
			if (!verified || !equal(verified, { attestation: value }))
				return Object.freeze({ accepted: false, code: "correlation-mismatch", value: null });
			return safe(
				persistence.appendAttestationAtomically({
					value,
					verified,
					hostNowMs,
				}),
			);
		},
		revokeAttestation: async (tenantId: string, attestationId: string) =>
			safe(persistence.revokeAttestationAtomically({ tenantId, attestationId, hostNowMs: now() })),
		proposeAction: async (v: ProductionMigrationActionProposal) => {
			const value = checked(v, kinds.proposal);
			const hostNowMs = now();
			const verified = productionEvaluationSnapshot(
				await migrationPrerequisiteAuthority.lookup(value),
			);
			if (
				!verified ||
				!equal(verified, {
					scope: value.pins.scope,
					campaignId: value.pins.campaignId,
					campaignRevision: value.pins.campaignRevision,
					candidate: value.pins.target,
					evidenceHighWater: value.pins.evidenceHighWater,
					attestationRef: value.pins.attestationRef,
					trafficRefs: value.pins.trafficRefs,
					dataRefs: value.pins.dataRefs,
					schemaRefs: value.pins.schemaRefs,
					policyRefs: value.pins.policyRefs,
					credentialPostureRefs: value.pins.credentialPostureRefs,
					prerequisiteRefs: value.pins.prerequisiteRefs,
					coexistenceEvidenceRefs: value.pins.coexistenceEvidenceRefs,
					predecessorActionRefs: value.pins.predecessorActionRefs,
					rollbackPlan: value.pins.rollbackPlan,
					policyRevision: verified.policyRevision,
					checkedAtMs: verified.checkedAtMs,
					expiresAtMs: verified.expiresAtMs,
				})
			)
				return Object.freeze({ accepted: false, code: "ineligible", value: null });
			return safe(
				persistence.appendActionProposalAndAdvanceFenceAtomically({
					value,
					verified,
					hostNowMs,
				}),
			);
		},
		admitAction: async (v: ProductionMigrationActionAdmission) =>
			safe(
				persistence.appendActionAdmissionAtomically({
					value: checked(v, kinds.admission),
					hostNowMs: now(),
				}),
			),
		materializeAction: async (v: ProductionMigrationActionMaterialization) =>
			safe(
				persistence.materializeAdmittedActionAtomically({
					value: checked(v, kinds.materialization),
					hostNowMs: now(),
				}),
			),
		lowerMaterializedActionExecution: async (v: ProductionMigrationExecutionHandoffIntent) =>
			safe(
				persistence.lowerMaterializedActionExecutionAtomically({
					value: checked(v, kinds.handoff),
					hostNowMs: now(),
				}),
			),
		recordMigrationExecutionBinding: async (v: ProductionMigrationExecutionBinding) =>
			safe(
				persistence.recordMigrationExecutionBindingAtomically({
					value: checked(v, kinds.binding),
					hostNowMs: now(),
				}),
			),
		settleMigrationExecutionBinding: async (v: ProductionMigrationExecutionSettlement) =>
			safe(
				persistence.settleMigrationExecutionBindingAtomically({
					value: checked(v, kinds.settlement),
					hostNowMs: now(),
				}),
			),
		recordActionOutcome: async (v: ProductionMigrationActionOutcome) => {
			const value = checked(v, kinds.outcome);
			const hostNowMs = now();
			const verified = productionEvaluationSnapshot(
				await migrationOutcomeAuthority.lookup({
					scope: value.scope,
					actionId: value.actionId,
					admissionId: value.admissionId,
					materializationId: value.materializationId,
					executorRunId: value.executorRunId,
					providerRequestId: value.providerRequestId,
					providerAdmissionId: value.providerAdmissionId,
					providerOutcomeId: value.providerOutcomeId,
					providerEvidenceId: value.providerEvidenceId,
					providerAttempt: value.providerAttempt,
					sourceRefs: value.sourceRefs,
				}),
			);
			if (
				!verified ||
				!equal(verified, {
					actionId: value.actionId,
					admissionId: value.admissionId,
					materializationId: value.materializationId,
					actionKind: value.actionKind,
					generation: value.generation,
					fence: value.fence,
					executorRunId: value.executorRunId,
					providerRequestId: value.providerRequestId,
					providerAdmissionId: value.providerAdmissionId,
					providerOutcomeId: value.providerOutcomeId,
					providerEvidenceId: value.providerEvidenceId,
					providerAttempt: value.providerAttempt,
					sourceRefs: value.sourceRefs,
					state: value.state,
					evidenceRefs: value.evidenceRefs,
					terminalHighWater: value.terminalHighWater,
				})
			)
				return Object.freeze({ accepted: false, code: "correlation-mismatch", value: null });
			return safe(
				persistence.appendActionTerminalOutcomeAtomically({
					value,
					verified,
					hostNowMs,
				}),
			);
		},
		recordPacketManifest: async (v: ProductionEvidencePacketManifest) => {
			const value = checked(v, kinds.packet);
			const hostNowMs = now();
			const verified = productionEvaluationSnapshot(await packetAdmissionAuthority.lookup(value));
			if (!verified) return Object.freeze({ accepted: false, code: "ineligible", value: null });
			return safe(
				persistence.appendEvidencePacketManifestAtomically({
					value,
					verified,
					hostNowMs,
				}),
			);
		},
		readAudit: async (tenantId: string) =>
			productionEvaluationSnapshot(await persistence.readOrderedAudit({ tenantId })),
	});
	return authority;
}
