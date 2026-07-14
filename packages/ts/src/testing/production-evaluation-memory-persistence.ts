/** Test-only atomic in-memory implementation of the D610 narrow persistence port. */
import type { ProductionEvaluationPersistencePort } from "../solutions/production-evaluation-authority.js";
import type {
	ProductionAttestation,
	ProductionEvaluationAuditEntry,
	ProductionEvaluationCampaignRevision,
	ProductionEvaluationStoreResult,
	ProductionEvidencePacketManifest,
	ProductionMigrationActionAdmission,
	ProductionMigrationActionMaterialization,
	ProductionMigrationActionOutcome,
	ProductionMigrationActionProposal,
	ProductionMigrationExecutionBinding,
	ProductionMigrationExecutionHandoffIntent,
	ProductionMigrationExecutionRequest,
	ProductionMigrationExecutionSettlement,
	ProductionScenarioResult,
	ProductionVerifiedMigrationPrerequisites,
} from "../solutions/production-evaluation-contracts.js";
import {
	productionEvaluationCanonical as canonical,
	sameProductionCandidate,
	productionEvaluationSnapshot as snapshot,
} from "../solutions/production-evaluation-contracts.js";

type State = {
	campaigns: Map<string, ProductionEvaluationCampaignRevision>;
	campaignHeads: Map<string, string>;
	results: Map<string, ProductionScenarioResult>;
	resultIds: Map<string, ProductionScenarioResult>;
	attestations: Map<string, ProductionAttestation>;
	attestationIdempotency: Map<string, ProductionAttestation>;
	attestationDecisions: Map<string, ProductionAttestation>;
	proposals: Map<string, ProductionMigrationActionProposal>;
	proposalPrerequisites: Map<string, ProductionVerifiedMigrationPrerequisites>;
	actionFences: Map<string, number>;
	actionIdempotency: Map<string, ProductionMigrationActionProposal>;
	admissions: Map<string, ProductionMigrationActionAdmission>;
	materializations: Map<string, ProductionMigrationActionMaterialization>;
	actionMaterializations: Map<string, ProductionMigrationActionMaterialization>;
	handoffIntents: Map<string, ProductionMigrationExecutionHandoffIntent>;
	handoffs: Map<string, ProductionMigrationExecutionRequest>;
	executionBindings: Map<string, ProductionMigrationExecutionBinding>;
	executionSettlements: Map<string, ProductionMigrationExecutionSettlement>;
	providerBindingIds: Map<string, ProductionMigrationExecutionBinding>;
	outcomes: Map<string, ProductionMigrationActionOutcome>;
	packets: Map<string, ProductionEvidencePacketManifest>;
	audit: ProductionEvaluationAuditEntry[];
	sequence: number;
};
const initial = (): State => ({
	campaigns: new Map(),
	campaignHeads: new Map(),
	results: new Map(),
	resultIds: new Map(),
	attestations: new Map(),
	attestationIdempotency: new Map(),
	attestationDecisions: new Map(),
	proposals: new Map(),
	proposalPrerequisites: new Map(),
	actionFences: new Map(),
	actionIdempotency: new Map(),
	admissions: new Map(),
	materializations: new Map(),
	actionMaterializations: new Map(),
	handoffIntents: new Map(),
	handoffs: new Map(),
	executionBindings: new Map(),
	executionSettlements: new Map(),
	providerBindingIds: new Map(),
	outcomes: new Map(),
	packets: new Map(),
	audit: [],
	sequence: 0,
});
const key = (...parts: readonly (string | number)[]) => parts.join("\u001f");
const yes = <T>(
	code: "created" | "rereferenced" | "advanced",
	value: T,
): ProductionEvaluationStoreResult<T> => snapshot({ accepted: true, code, value });
const no = <T>(
	code: Exclude<ProductionEvaluationStoreResult<T>, { accepted: true }>["code"],
): ProductionEvaluationStoreResult<T> => snapshot({ accepted: false, code, value: null });
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const validTime = (claimed: number, host: number) => claimed === host;
const scopeKey = (v: { scope: { tenantId: string; workspaceId: string }; campaignId: string }) =>
	key(v.scope.tenantId, v.scope.workspaceId, v.campaignId);

export interface ProductionEvaluationMemoryPersistence extends ProductionEvaluationPersistencePort {
	failNextCommit(): void;
}
export function createProductionEvaluationMemoryPersistence(): ProductionEvaluationMemoryPersistence {
	let state = initial();
	let tail = Promise.resolve();
	let fail = false;
	async function atomic<T>(work: (draft: State) => T | Promise<T>): Promise<T> {
		const prior = tail;
		let release!: () => void;
		tail = new Promise((r) => {
			release = r;
		});
		await prior;
		const draft = structuredClone(state);
		try {
			const result = await work(draft);
			if (fail) {
				fail = false;
				throw new Error("production-evaluation-memory-commit-failed");
			}
			state = draft;
			return snapshot(result) as T;
		} finally {
			release();
		}
	}
	function audit(d: State, tenantId: string, eventKind: string, objectId: string, at: number) {
		d.audit.push(
			snapshot({
				kind: "production-evaluation-audit",
				tenantId,
				sequence: ++d.sequence,
				eventKind,
				objectId,
				occurredAtMs: at,
			}),
		);
	}
	function exact<T>(
		map: Map<string, T>,
		k: string,
		value: T,
	): ProductionEvaluationStoreResult<T> | null {
		const prior = map.get(k);
		if (!prior) return null;
		return same(prior, value) ? yes("rereferenced", prior) : no("conflict");
	}
	const currentCampaign = (
		d: State,
		scope: { tenantId: string; workspaceId: string },
		campaignId: string,
		revision: string,
	) => {
		const sk = scopeKey({ scope, campaignId });
		if (d.campaignHeads.get(sk) !== revision) return null;
		return d.campaigns.get(key(sk, revision)) ?? null;
	};
	const campaignHighWater = (
		d: State,
		scope: { tenantId: string; workspaceId: string },
		campaignId: string,
		revision: string,
	) =>
		Math.max(
			0,
			...[...d.results.values()]
				.filter(
					(r) =>
						same(r.scope, scope) && r.campaignId === campaignId && r.campaignRevision === revision,
				)
				.map((r) => r.evidenceHighWater),
		);
	const resultForRef = (d: State, ref: { id: string; revision: string }) =>
		[...d.results.values()].find(
			(r) => r.resultId === ref.id && r.scenarioRevision === ref.revision,
		);
	const outcomeForRef = (d: State, ref: { id: string; revision: string }) =>
		[...d.outcomes.values()].find((o) => o.actionId === ref.id && o.outcomeId === ref.revision);
	const currentAction = (d: State, proposal: ProductionMigrationActionProposal) => {
		const fk = key(
			proposal.pins.scope.tenantId,
			proposal.pins.scope.workspaceId,
			proposal.pins.campaignId,
		);
		return (
			d.actionFences.get(fk) === proposal.fence &&
			!!currentCampaign(
				d,
				proposal.pins.scope,
				proposal.pins.campaignId,
				proposal.pins.campaignRevision,
			) &&
			campaignHighWater(
				d,
				proposal.pins.scope,
				proposal.pins.campaignId,
				proposal.pins.campaignRevision,
			) === proposal.pins.evidenceHighWater
		);
	};
	const effectiveActionPrerequisites = (
		d: State,
		proposal: ProductionMigrationActionProposal,
		at: number,
	) => {
		const verified = d.proposalPrerequisites.get(
			key(proposal.pins.scope.tenantId, proposal.actionId),
		);
		const attestation = d.attestations.get(
			key(proposal.pins.scope.tenantId, proposal.pins.attestationRef.id),
		);
		const superseded = [...d.attestations.values()].some(
			(item) =>
				item.scope.tenantId === proposal.pins.scope.tenantId &&
				item.supersedesId === attestation?.attestationId,
		);
		return (
			!!verified &&
			verified.expiresAtMs > at &&
			!!attestation &&
			attestation.revokedAtMs === null &&
			attestation.issuedAtMs <= at &&
			attestation.expiresAtMs > at &&
			same(attestation.scope, proposal.pins.scope) &&
			attestation.campaignId === proposal.pins.campaignId &&
			attestation.campaignRevision === proposal.pins.campaignRevision &&
			sameProductionCandidate(attestation.candidate, proposal.pins.target) &&
			attestation.policyRevision === proposal.pins.attestationRef.revision &&
			attestation.evidenceHighWater === proposal.pins.evidenceHighWater &&
			!superseded
		);
	};
	return {
		failNextCommit() {
			fail = true;
		},
		createCampaignRevisionAndAdvanceHeadAtomically: ({ value, hostNowMs }) =>
			atomic((d) => {
				if (!validTime(value.createdAtMs, hostNowMs)) return no("invalid");
				const sk = scopeKey(value),
					k = key(sk, value.revision),
					prior = exact(d.campaigns, k, value);
				if (prior) return prior;
				const head = d.campaignHeads.get(sk) ?? null;
				if (head !== value.previousRevision) return no("stale-head");
				d.campaigns.set(k, snapshot(value));
				d.campaignHeads.set(sk, value.revision);
				audit(d, value.scope.tenantId, "campaign-revision-created", value.campaignId, hostNowMs);
				return yes("advanced", value);
			}),
		appendScenarioResultAtomically: ({ value, verified, hostNowMs }) =>
			atomic((d) => {
				if (!validTime(value.recordedAtMs, hostNowMs)) return no("invalid");
				const campaign = currentCampaign(d, value.scope, value.campaignId, value.campaignRevision);
				if (!campaign) return no("not-found");
				if (
					!same(verified, {
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
					return no("correlation-mismatch");
				const scenario = campaign.scenarios.find((item) => item.scenarioId === value.scenarioId);
				if (
					!sameProductionCandidate(campaign.candidate, value.candidate) ||
					!scenario ||
					scenario.revision !== value.scenarioRevision
				)
					return no("correlation-mismatch");
				const resultIdKey = key(value.scope.tenantId, value.resultId);
				const resultIdPrior = d.resultIds.get(resultIdKey);
				if (resultIdPrior)
					return same(resultIdPrior, value) ? yes("rereferenced", resultIdPrior) : no("conflict");
				const k = key(
					scopeKey(value),
					value.campaignRevision,
					value.scenarioId,
					value.scenarioRevision,
					value.requestId,
					value.admissionId,
					value.runId,
					value.attempt,
					value.outcomeId,
					value.evidenceId,
				);
				const prior = exact(d.results, k, value);
				if (prior) return prior;
				d.results.set(k, snapshot(value));
				d.resultIds.set(resultIdKey, snapshot(value));
				audit(d, value.scope.tenantId, "scenario-result-recorded", value.evidenceId, hostNowMs);
				return yes("created", value);
			}),
		appendAttestationAtomically: ({ value, verified, hostNowMs }) =>
			atomic((d) => {
				if (!same(verified, { attestation: value })) return no("correlation-mismatch");
				if (
					!validTime(value.issuedAtMs, hostNowMs) ||
					value.expiresAtMs <= hostNowMs ||
					value.revokedAtMs !== null
				)
					return no("invalid");
				const campaign = currentCampaign(d, value.scope, value.campaignId, value.campaignRevision);
				if (
					!campaign ||
					!sameProductionCandidate(campaign.candidate, value.candidate) ||
					campaign.criteria.revision !== value.criteriaRevision
				)
					return no("correlation-mismatch");
				if (
					value.evidenceHighWater !==
					campaignHighWater(d, value.scope, value.campaignId, value.campaignRevision)
				)
					return no("correlation-mismatch");
				if (value.supersedesId) {
					const old = d.attestations.get(key(value.scope.tenantId, value.supersedesId));
					if (
						!old ||
						!same(old.scope, value.scope) ||
						old.campaignId !== value.campaignId ||
						old.campaignRevision !== value.campaignRevision ||
						!sameProductionCandidate(old.candidate, value.candidate) ||
						old.issuedAtMs >= value.issuedAtMs
					)
						return no("not-found");
				}
				const idemKey = key(value.scope.tenantId, value.scope.workspaceId, value.idempotencyKey);
				const idemPrior = d.attestationIdempotency.get(idemKey);
				if (idemPrior)
					return same(idemPrior, value) ? yes("rereferenced", idemPrior) : no("conflict");
				const decisionKey = key(value.scope.tenantId, value.decisionId);
				const decisionPrior = d.attestationDecisions.get(decisionKey);
				if (decisionPrior)
					return same(decisionPrior, value) ? yes("rereferenced", decisionPrior) : no("conflict");
				const k = key(value.scope.tenantId, value.attestationId),
					prior = exact(d.attestations, k, value);
				if (prior) return prior;
				d.attestations.set(k, snapshot(value));
				d.attestationIdempotency.set(idemKey, snapshot(value));
				d.attestationDecisions.set(decisionKey, snapshot(value));
				audit(d, value.scope.tenantId, "attestation-appended", value.attestationId, hostNowMs);
				return yes("created", value);
			}),
		revokeAttestationAtomically: ({ tenantId, attestationId, hostNowMs }) =>
			atomic((d) => {
				const k = key(tenantId, attestationId),
					old = d.attestations.get(k);
				if (!old) return no("not-found");
				if (old.revokedAtMs !== null) return yes("rereferenced", old);
				const next = snapshot({ ...old, revokedAtMs: hostNowMs });
				d.attestations.set(k, next);
				audit(d, tenantId, "attestation-revoked", attestationId, hostNowMs);
				return yes("advanced", next);
			}),
		appendActionProposalAndAdvanceFenceAtomically: ({ value, verified, hostNowMs }) =>
			atomic((d) => {
				if (!validTime(value.requestedAtMs, hostNowMs) || value.generation < 1 || value.fence < 1)
					return no("invalid");
				const campaign = currentCampaign(
					d,
					value.pins.scope,
					value.pins.campaignId,
					value.pins.campaignRevision,
				);
				if (!campaign || !sameProductionCandidate(campaign.candidate, value.pins.target))
					return no("correlation-mismatch");
				if (
					campaignHighWater(
						d,
						value.pins.scope,
						value.pins.campaignId,
						value.pins.campaignRevision,
					) !== value.pins.evidenceHighWater ||
					verified.checkedAtMs > hostNowMs ||
					verified.expiresAtMs <= hostNowMs ||
					!same(verified.scope, value.pins.scope) ||
					verified.campaignId !== value.pins.campaignId ||
					verified.campaignRevision !== value.pins.campaignRevision ||
					!sameProductionCandidate(verified.candidate, value.pins.target) ||
					verified.evidenceHighWater !== value.pins.evidenceHighWater ||
					!same(verified.attestationRef, value.pins.attestationRef) ||
					!same(verified.trafficRefs, value.pins.trafficRefs) ||
					!same(verified.dataRefs, value.pins.dataRefs) ||
					!same(verified.schemaRefs, value.pins.schemaRefs) ||
					!same(verified.policyRefs, value.pins.policyRefs) ||
					!same(verified.credentialPostureRefs, value.pins.credentialPostureRefs) ||
					!same(verified.prerequisiteRefs, value.pins.prerequisiteRefs) ||
					!same(verified.coexistenceEvidenceRefs, value.pins.coexistenceEvidenceRefs) ||
					!same(verified.predecessorActionRefs, value.pins.predecessorActionRefs) ||
					!same(verified.rollbackPlan, value.pins.rollbackPlan)
				)
					return no("ineligible");
				const attestation = d.attestations.get(
					key(value.pins.scope.tenantId, value.pins.attestationRef.id),
				);
				if (
					!attestation ||
					attestation.revokedAtMs !== null ||
					attestation.expiresAtMs <= hostNowMs ||
					!same(attestation.scope, value.pins.scope) ||
					attestation.campaignId !== value.pins.campaignId ||
					attestation.campaignRevision !== value.pins.campaignRevision ||
					!sameProductionCandidate(attestation.candidate, value.pins.target) ||
					attestation.policyRevision !== value.pins.attestationRef.revision ||
					attestation.evidenceHighWater !== value.pins.evidenceHighWater ||
					attestation.policyRevision !== verified.policyRevision
				)
					return no("ineligible");
				if (
					[...d.attestations.values()].some(
						(item) =>
							item.scope.tenantId === value.pins.scope.tenantId &&
							item.supersedesId === attestation.attestationId,
					)
				)
					return no("ineligible");
				if (
					value.actionKind !== "observe" &&
					sameProductionCandidate(value.pins.source, value.pins.target)
				)
					return no("ineligible");
				for (const ref of value.pins.coexistenceEvidenceRefs) {
					const result = resultForRef(d, ref);
					if (
						!result ||
						result.outcome !== "succeeded" ||
						!same(result.scope, value.pins.scope) ||
						result.campaignId !== value.pins.campaignId ||
						result.campaignRevision !== value.pins.campaignRevision ||
						!sameProductionCandidate(result.candidate, value.pins.target) ||
						result.evidenceHighWater > value.pins.evidenceHighWater
					)
						return no("ineligible");
				}
				for (const ref of value.pins.predecessorActionRefs) {
					const outcome = outcomeForRef(d, ref);
					const predecessor =
						outcome && d.proposals.get(key(value.pins.scope.tenantId, outcome.actionId));
					if (
						!outcome ||
						!predecessor ||
						!same(outcome.scope, value.pins.scope) ||
						predecessor.pins.campaignId !== value.pins.campaignId ||
						predecessor.pins.campaignRevision !== value.pins.campaignRevision ||
						!sameProductionCandidate(predecessor.pins.target, value.pins.target) ||
						(value.actionKind !== "rollback" && outcome.state !== "succeeded")
					)
						return no("ineligible");
				}
				const coexistenceHighWater = Math.max(
					0,
					...value.pins.coexistenceEvidenceRefs.map(
						(ref) => resultForRef(d, ref)?.evidenceHighWater ?? -1,
					),
				);
				if (
					(value.actionKind === "cutover" || value.actionKind === "decommission") &&
					(value.pins.coexistenceEvidenceRefs.length === 0 ||
						coexistenceHighWater !== value.pins.evidenceHighWater ||
						!value.pins.rollbackPlan.id)
				)
					return no("ineligible");
				if (
					value.actionKind === "decommission" &&
					!value.pins.predecessorActionRefs.some((ref) => {
						const outcome = outcomeForRef(d, ref);
						const predecessor =
							outcome && d.proposals.get(key(value.pins.scope.tenantId, outcome.actionId));
						return outcome?.state === "succeeded" && predecessor?.actionKind === "cutover";
					})
				)
					return no("ineligible");
				if (value.actionKind === "rollback" && value.pins.predecessorActionRefs.length === 0)
					return no("ineligible");
				const ik = key(
					value.pins.scope.tenantId,
					value.pins.scope.workspaceId,
					value.idempotencyKey,
				);
				const idem = d.actionIdempotency.get(ik);
				if (idem) return same(idem, value) ? yes("rereferenced", idem) : no("conflict");
				const k = key(value.pins.scope.tenantId, value.actionId),
					prior = exact(d.proposals, k, value);
				if (prior) return prior;
				const fk = key(
					value.pins.scope.tenantId,
					value.pins.scope.workspaceId,
					value.pins.campaignId,
				);
				if ((d.actionFences.get(fk) ?? 0) >= value.fence) return no("stale-fence");
				d.proposals.set(k, snapshot(value));
				d.proposalPrerequisites.set(k, snapshot(verified));
				d.actionIdempotency.set(ik, snapshot(value));
				d.actionFences.set(fk, value.fence);
				audit(d, value.pins.scope.tenantId, "action-proposed", value.actionId, hostNowMs);
				return yes("advanced", value);
			}),
		appendActionAdmissionAtomically: ({ value, hostNowMs }) =>
			atomic((d) => {
				if (!validTime(value.admittedAtMs, hostNowMs) || value.expiresAtMs <= hostNowMs)
					return no("invalid");
				const proposal = d.proposals.get(key(value.scope.tenantId, value.actionId));
				if (!proposal) return no("not-found");
				if (!currentAction(d, proposal)) return no("stale-fence");
				if (!effectiveActionPrerequisites(d, proposal, hostNowMs)) return no("ineligible");
				const prerequisites = d.proposalPrerequisites.get(
					key(value.scope.tenantId, value.actionId),
				);
				if (
					!prerequisites ||
					prerequisites.expiresAtMs <= hostNowMs ||
					prerequisites.policyRevision !== value.policyRevision
				)
					return no("ineligible");
				if (
					!same(proposal.pins.scope, value.scope) ||
					proposal.actionKind !== value.actionKind ||
					proposal.generation !== value.generation ||
					proposal.fence !== value.fence
				)
					return no("correlation-mismatch");
				const k = key(value.scope.tenantId, value.admissionId),
					prior = exact(d.admissions, k, value);
				if (prior) return prior;
				d.admissions.set(k, snapshot(value));
				audit(d, proposal.pins.scope.tenantId, "action-admitted", value.actionId, hostNowMs);
				return yes("created", value);
			}),
		materializeAdmittedActionAtomically: ({ value, hostNowMs }) =>
			atomic((d) => {
				if (!validTime(value.materializedAtMs, hostNowMs)) return no("invalid");
				const proposal = d.proposals.get(key(value.scope.tenantId, value.actionId));
				const admission = d.admissions.get(key(value.scope.tenantId, value.admissionId));
				if (!proposal || !admission) return no("not-found");
				if (!currentAction(d, proposal)) return no("stale-fence");
				if (!effectiveActionPrerequisites(d, proposal, hostNowMs)) return no("ineligible");
				if (admission.expiresAtMs <= hostNowMs) return no("expired");
				if (
					!same(proposal.pins.scope, value.scope) ||
					proposal.actionKind !== value.actionKind ||
					proposal.generation !== value.generation ||
					proposal.fence !== value.fence ||
					admission.actionId !== value.actionId
				)
					return no("correlation-mismatch");
				const actionMaterializationKey = key(
					value.scope.tenantId,
					value.actionId,
					value.admissionId,
				);
				const actionMaterialization = d.actionMaterializations.get(actionMaterializationKey);
				if (actionMaterialization)
					return same(actionMaterialization, value)
						? yes("rereferenced", actionMaterialization)
						: no("conflict");
				const k = key(value.scope.tenantId, value.materializationId),
					prior = exact(d.materializations, k, value);
				if (prior) return prior;
				d.materializations.set(k, snapshot(value));
				d.actionMaterializations.set(actionMaterializationKey, snapshot(value));
				audit(d, proposal.pins.scope.tenantId, "action-materialized", value.actionId, hostNowMs);
				return yes("created", value);
			}),
		lowerMaterializedActionExecutionAtomically: ({ value, hostNowMs }) =>
			atomic((d) => {
				const proposal = d.proposals.get(key(value.scope.tenantId, value.actionId));
				const admission = d.admissions.get(key(value.scope.tenantId, value.admissionId));
				const material = d.materializations.get(key(value.scope.tenantId, value.materializationId));
				if (!proposal || !admission || !material) return no("not-found");
				if (!currentAction(d, proposal)) return no("stale-fence");
				if (
					!effectiveActionPrerequisites(d, proposal, hostNowMs) ||
					admission.expiresAtMs <= hostNowMs
				)
					return no("ineligible");
				if (
					!same(proposal.pins.scope, value.scope) ||
					!same(material.scope, value.scope) ||
					admission.actionId !== value.actionId ||
					material.actionId !== value.actionId ||
					material.admissionId !== value.admissionId ||
					material.materializationId !== value.materializationId ||
					material.executorRequestId !== value.executorRequestId ||
					material.actionKind !== proposal.actionKind ||
					material.generation !== proposal.generation ||
					material.fence !== proposal.fence
				)
					return no("correlation-mismatch");
				const handoffKey = key(value.scope.tenantId, value.executorRequestId);
				const priorIntent = d.handoffIntents.get(handoffKey);
				const prior = d.handoffs.get(handoffKey);
				if (priorIntent || prior)
					return priorIntent && prior && same(priorIntent, value)
						? yes("rereferenced", prior)
						: no("conflict");
				const evidenceRefs = [
					...proposal.pins.prerequisiteRefs,
					proposal.pins.attestationRef,
					...proposal.pins.predecessorActionRefs,
					...proposal.pins.coexistenceEvidenceRefs,
					proposal.pins.rollbackPlan,
				];
				if (evidenceRefs.length > 128) return no("invalid");
				const request: ProductionMigrationExecutionRequest = snapshot({
					kind: "production-migration-execution-request",
					scope: value.scope,
					campaignId: proposal.pins.campaignId,
					campaignRevision: proposal.pins.campaignRevision,
					actionKind: proposal.actionKind,
					actionId: proposal.actionId,
					admissionId: admission.admissionId,
					materializationId: material.materializationId,
					executorRequestId: material.executorRequestId,
					generation: proposal.generation,
					fence: proposal.fence,
					source: proposal.pins.source,
					target: proposal.pins.target,
					trafficRefs: proposal.pins.trafficRefs,
					dataRefs: proposal.pins.dataRefs,
					schemaRefs: proposal.pins.schemaRefs,
					policyRefs: proposal.pins.policyRefs,
					credentialPostureRefs: proposal.pins.credentialPostureRefs,
					prerequisiteRefs: proposal.pins.prerequisiteRefs,
					attestationRef: proposal.pins.attestationRef,
					predecessorActionRefs: proposal.pins.predecessorActionRefs,
					coexistenceEvidenceRefs: proposal.pins.coexistenceEvidenceRefs,
					rollbackPlan: proposal.pins.rollbackPlan,
					evidenceHighWater: proposal.pins.evidenceHighWater,
					evidenceRefs,
					loweredAtMs: hostNowMs,
				});
				d.handoffIntents.set(handoffKey, snapshot(value));
				d.handoffs.set(handoffKey, request);
				audit(d, value.scope.tenantId, "migration-execution-lowered", value.actionId, hostNowMs);
				return yes("created", request);
			}),
		recordMigrationExecutionBindingAtomically: ({ value, hostNowMs }) =>
			atomic((d) => {
				if (!validTime(value.boundAtMs, hostNowMs)) return no("invalid");
				const handoff = d.handoffs.get(key(value.scope.tenantId, value.executorRequestId));
				if (!handoff) return no("not-found");
				if (
					!same(handoff.scope, value.scope) ||
					handoff.campaignId !== value.campaignId ||
					handoff.campaignRevision !== value.campaignRevision ||
					handoff.actionKind !== value.actionKind ||
					handoff.actionId !== value.actionId ||
					handoff.admissionId !== value.admissionId ||
					handoff.materializationId !== value.materializationId ||
					handoff.executorRequestId !== value.executorRequestId ||
					handoff.generation !== value.generation ||
					handoff.fence !== value.fence
				)
					return no("correlation-mismatch");
				const bindingKey = key(value.scope.tenantId, value.executorRequestId);
				const prior = d.executionBindings.get(bindingKey);
				if (prior) return same(prior, value) ? yes("rereferenced", prior) : no("conflict");
				for (const [kind, id] of [
					["request", value.providerRequestId],
					["admission", value.providerAdmissionId],
					["run", value.providerRunId],
				] as const) {
					const idKey = key(value.scope.tenantId, kind, id);
					const existing = d.providerBindingIds.get(idKey);
					if (existing && !same(existing, value)) return no("conflict");
				}
				d.executionBindings.set(bindingKey, snapshot(value));
				for (const [kind, id] of [
					["request", value.providerRequestId],
					["admission", value.providerAdmissionId],
					["run", value.providerRunId],
				] as const)
					d.providerBindingIds.set(key(value.scope.tenantId, kind, id), snapshot(value));
				audit(d, value.scope.tenantId, "migration-execution-bound", value.actionId, hostNowMs);
				return yes("created", value);
			}),
		settleMigrationExecutionBindingAtomically: ({ value, hostNowMs }) =>
			atomic((d) => {
				if (!validTime(value.settledAtMs, hostNowMs)) return no("invalid");
				const bindingKey = key(value.scope.tenantId, value.executorRequestId);
				const binding = d.executionBindings.get(bindingKey);
				if (!binding) return no("not-found");
				if (
					!same(binding.scope, value.scope) ||
					binding.providerRequestId !== value.providerRequestId ||
					binding.providerAdmissionId !== value.providerAdmissionId ||
					binding.providerRunId !== value.providerRunId ||
					binding.providerAttempt !== value.providerAttempt ||
					!same(binding.sourceRefs, value.sourceRefs)
				)
					return no("correlation-mismatch");
				const prior = d.executionSettlements.get(bindingKey);
				if (prior) return same(prior, value) ? yes("rereferenced", prior) : no("conflict");
				for (const [kind, id] of [
					["outcome", value.providerOutcomeId],
					["evidence", value.providerEvidenceId],
				] as const) {
					const existing = d.providerBindingIds.get(key(value.scope.tenantId, kind, id));
					if (existing) return no("conflict");
				}
				d.executionSettlements.set(bindingKey, snapshot(value));
				for (const [kind, id] of [
					["outcome", value.providerOutcomeId],
					["evidence", value.providerEvidenceId],
				] as const)
					d.providerBindingIds.set(key(value.scope.tenantId, kind, id), snapshot(binding));
				audit(d, value.scope.tenantId, "migration-execution-settled", binding.actionId, hostNowMs);
				return yes("created", value);
			}),
		appendActionTerminalOutcomeAtomically: ({ value, verified, hostNowMs }) =>
			atomic((d) => {
				if (!validTime(value.recordedAtMs, hostNowMs)) return no("invalid");
				if (
					!same(verified, {
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
					return no("correlation-mismatch");
				const proposal = d.proposals.get(key(value.scope.tenantId, value.actionId));
				const material = d.materializations.get(key(value.scope.tenantId, value.materializationId));
				if (!proposal || !material) return no("not-found");
				const binding = d.executionBindings.get(
					key(value.scope.tenantId, material.executorRequestId),
				);
				if (!binding) return no("not-found");
				const settlement = d.executionSettlements.get(
					key(value.scope.tenantId, material.executorRequestId),
				);
				if (!settlement) return no("not-found");
				if (
					!same(proposal.pins.scope, value.scope) ||
					!same(material.scope, value.scope) ||
					material.actionId !== value.actionId ||
					material.admissionId !== value.admissionId ||
					material.actionKind !== value.actionKind ||
					material.generation !== value.generation ||
					material.fence !== value.fence ||
					!same(binding.scope, value.scope) ||
					binding.actionId !== value.actionId ||
					binding.admissionId !== value.admissionId ||
					binding.materializationId !== value.materializationId ||
					binding.generation !== value.generation ||
					binding.fence !== value.fence ||
					binding.providerRequestId !== value.providerRequestId ||
					binding.providerAdmissionId !== value.providerAdmissionId ||
					binding.providerRunId !== value.executorRunId ||
					binding.providerAttempt !== value.providerAttempt ||
					!same(binding.sourceRefs, value.sourceRefs) ||
					settlement.providerRequestId !== value.providerRequestId ||
					settlement.providerAdmissionId !== value.providerAdmissionId ||
					settlement.providerRunId !== value.executorRunId ||
					settlement.providerAttempt !== value.providerAttempt ||
					settlement.providerOutcomeId !== value.providerOutcomeId ||
					settlement.providerEvidenceId !== value.providerEvidenceId ||
					settlement.providerEvidenceHighWater !== value.terminalHighWater ||
					!same(settlement.sourceRefs, value.sourceRefs)
				)
					return no("correlation-mismatch");
				const outcomeIdKey = key(value.scope.tenantId, value.outcomeId);
				const outcomeIdPrior = d.outcomes.get(outcomeIdKey);
				if (outcomeIdPrior)
					return same(outcomeIdPrior, value) ? yes("rereferenced", outcomeIdPrior) : no("conflict");
				const actionTerminal = [...d.outcomes.values()].find(
					(o) => same(o.scope, value.scope) && o.actionId === value.actionId,
				);
				if (actionTerminal)
					return same(actionTerminal, value)
						? yes("rereferenced", actionTerminal)
						: no("already-terminal");
				d.outcomes.set(outcomeIdKey, snapshot(value));
				audit(
					d,
					proposal.pins.scope.tenantId,
					"action-terminal-outcome",
					value.actionId,
					hostNowMs,
				);
				return yes("created", value);
			}),
		appendEvidencePacketManifestAtomically: ({ value, verified, hostNowMs }) =>
			atomic((d) => {
				if (!validTime(value.createdAtMs, hostNowMs)) return no("invalid");
				const campaign = currentCampaign(d, value.scope, value.campaignId, value.campaignRevision);
				if (!campaign || !sameProductionCandidate(campaign.candidate, value.candidate))
					return no("correlation-mismatch");
				if (
					value.evidenceHighWater !==
						campaignHighWater(d, value.scope, value.campaignId, value.campaignRevision) ||
					verified.expiresAtMs <= hostNowMs ||
					verified.admittedAtMs > hostNowMs ||
					!same(verified, {
						admissionId: value.admissionId,
						packetId: value.packetId,
						scope: value.scope,
						campaignId: value.campaignId,
						campaignRevision: value.campaignRevision,
						candidate: value.candidate,
						evidenceHighWater: value.evidenceHighWater,
						resultRefs: value.resultRefs,
						attestationRefs: value.attestationRefs,
						actionRefs: value.actionRefs,
						policyRevision: value.policyRevision,
						redactionRevision: value.redactionRevision,
						admittedAtMs: verified.admittedAtMs,
						expiresAtMs: verified.expiresAtMs,
					})
				)
					return no("ineligible");
				for (const ref of value.resultRefs) {
					const result = resultForRef(d, ref);
					if (
						!result ||
						!same(result.scope, value.scope) ||
						result.campaignId !== value.campaignId ||
						result.campaignRevision !== value.campaignRevision ||
						!sameProductionCandidate(result.candidate, value.candidate) ||
						result.evidenceHighWater > value.evidenceHighWater
					)
						return no("ineligible");
				}
				for (const ref of value.attestationRefs) {
					const item = d.attestations.get(key(value.scope.tenantId, ref.id));
					if (
						!item ||
						item.policyRevision !== ref.revision ||
						!same(item.scope, value.scope) ||
						item.campaignId !== value.campaignId ||
						item.campaignRevision !== value.campaignRevision ||
						!sameProductionCandidate(item.candidate, value.candidate)
					)
						return no("ineligible");
				}
				for (const ref of value.actionRefs) {
					const item = outcomeForRef(d, ref);
					const proposal = item && d.proposals.get(key(value.scope.tenantId, item.actionId));
					if (
						!item ||
						!proposal ||
						!same(item.scope, value.scope) ||
						proposal.pins.campaignId !== value.campaignId ||
						proposal.pins.campaignRevision !== value.campaignRevision ||
						!sameProductionCandidate(proposal.pins.target, value.candidate) ||
						proposal.pins.evidenceHighWater > value.evidenceHighWater
					)
						return no("ineligible");
				}
				const k = key(value.scope.tenantId, value.packetId),
					prior = exact(d.packets, k, value);
				if (prior) return prior;
				d.packets.set(k, snapshot(value));
				audit(d, value.scope.tenantId, "packet-manifest-appended", value.packetId, hostNowMs);
				return yes("created", value);
			}),
		readOrderedAudit: async ({ tenantId }) =>
			snapshot(
				state.audit.filter((a) => a.tenantId === tenantId).sort((a, b) => a.sequence - b.sequence),
			),
	};
}
