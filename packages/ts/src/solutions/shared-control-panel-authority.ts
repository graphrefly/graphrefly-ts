/** Database-neutral shared control-panel authority facade (D609). Root intentionally closed. */
import type {
	SharedControlPanelAlert,
	SharedControlPanelAuditEntry,
	SharedControlPanelCandidate,
	SharedControlPanelCanonicalTruth,
	SharedControlPanelCompletedOccurrence,
	SharedControlPanelCurrentTruth,
	SharedControlPanelGrant,
	SharedControlPanelHostClock,
	SharedControlPanelHostSubscriptionRequest,
	SharedControlPanelInboxDelivery,
	SharedControlPanelOccurrence,
	SharedControlPanelQueryRerunRequest,
	SharedControlPanelRecordedAdmission,
	SharedControlPanelRecordedTerminalOutcome,
	SharedControlPanelRestrictedProjection,
	SharedControlPanelRevision,
	SharedControlPanelSignal,
	SharedControlPanelStoreResult,
	SharedControlPanelSubscriptionBindingAuthority,
	SharedControlPanelSubscriptionRevision,
	SharedControlPanelSuppression,
	SharedControlPanelTerminalOutcomeAuthority,
	SharedControlPanelVerifiedTerminalOutcome,
} from "./shared-control-panel-contracts.js";
import {
	canonical,
	clockNow,
	sharedControlPanelCapabilitySupported,
	sharedControlPanelRecordedOutcomeMatchesCompleted,
	snapshot,
	validateAlert,
	validateAudit,
	validateCandidate,
	validateCanonicalTruth,
	validateCanvasSubscriptionBinding,
	validateCompleted,
	validateDelivery,
	validateGrant,
	validateHostSubscriptionRequest,
	validateOccurrence,
	validateQueryRerun,
	validateRecordedAdmission,
	validateRecordedTerminalOutcome,
	validateRestrictedProjection,
	validateRevision,
	validateSignal,
	validateSubscription,
	validateSuppression,
	validateTruth,
} from "./shared-control-panel-contracts.js";

export type {
	SharedControlPanelAlert,
	SharedControlPanelAuditEntry,
	SharedControlPanelCandidate,
	SharedControlPanelCanonicalTruth,
	SharedControlPanelCanvasCoordinate,
	SharedControlPanelCanvasSubscriptionBinding,
	SharedControlPanelCanvasSubscriptionIntent,
	SharedControlPanelCapability,
	SharedControlPanelCompletedOccurrence,
	SharedControlPanelCondition,
	SharedControlPanelCurrentTruth,
	SharedControlPanelFrame,
	SharedControlPanelGrant,
	SharedControlPanelHostClock,
	SharedControlPanelHostSubscriptionRequest,
	SharedControlPanelInboxDelivery,
	SharedControlPanelOccurrence,
	SharedControlPanelOccurrenceEvaluation,
	SharedControlPanelPins,
	SharedControlPanelQueryRerunBinding,
	SharedControlPanelQueryRerunRequest,
	SharedControlPanelRecordedAdmission,
	SharedControlPanelRecordedTerminalOutcome,
	SharedControlPanelRestrictedProjection,
	SharedControlPanelRevision,
	SharedControlPanelSignal,
	SharedControlPanelStoreResult,
	SharedControlPanelSubscriptionBindingAuthority,
	SharedControlPanelSubscriptionRevision,
	SharedControlPanelSuppression,
	SharedControlPanelTerminalOutcomeAuthority,
	SharedControlPanelVerifiedTerminalOutcome,
	SharedControlPanelWidget,
} from "./shared-control-panel-contracts.js";
export {
	sharedControlPanelAdmissionFingerprint,
	sharedControlPanelAdmitCanvasSubscriptionIntent,
	sharedControlPanelCapabilitySupported,
	sharedControlPanelCompletedOccurrenceCorrelates,
	sharedControlPanelConditionMatches,
	sharedControlPanelRecordedOutcomeMatchesCompleted,
} from "./shared-control-panel-contracts.js";

export const SHARED_CONTROL_PANEL_AUTHORITY_COMPATIBILITY =
	"shared-control-panel-authority-v1" as const;

export interface SharedControlPanelPersistencePort {
	recordCanonicalTruthAtomically(
		command: Readonly<{ value: SharedControlPanelCanonicalTruth; hostNowMs: number }>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelCanonicalTruth>>;
	recordAdmissionForOccurrenceAtomically(
		command: Readonly<{ value: SharedControlPanelRecordedAdmission; hostNowMs: number }>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRecordedAdmission>>;
	readAdmissionForTerminalOutcome(
		command: Readonly<{ tenantId: string; occurrenceId: string }>,
	): Promise<SharedControlPanelRecordedAdmission | null>;
	recordVerifiedTerminalOutcomeAtomically(
		command: Readonly<{
			value: SharedControlPanelRecordedTerminalOutcome;
			verified: SharedControlPanelVerifiedTerminalOutcome;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRecordedTerminalOutcome>>;
	recordQueryRerunAtomically(
		command: Readonly<{ value: SharedControlPanelQueryRerunRequest; hostNowMs: number }>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelQueryRerunRequest>>;
	materializeQueryRerunAtomically(
		command: Readonly<{ value: SharedControlPanelQueryRerunRequest; hostNowMs: number }>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelCandidate>>;
	createRevisionAndAdvanceHeadAtomically(
		command: Readonly<{
			value: SharedControlPanelRevision;
			idempotencyKey: string;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRevision>>;
	reopenCurrentRevisionAtomically(
		command: Readonly<{
			tenantId: string;
			workspaceId: string;
			panelId: string;
			panelRevision: string;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRevision>>;
	projectAuthorizedRestrictedSnapshotAtomically(
		command: Readonly<{ truth: SharedControlPanelCurrentTruth; hostNowMs: number }>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRestrictedProjection>>;
	issueGrantAtomically(
		command: Readonly<{ value: SharedControlPanelGrant; hostNowMs: number }>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelGrant>>;
	revokeGrantAtomically(
		command: Readonly<{
			tenantId: string;
			grantId: string;
			revokedAtMs: number;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelGrant>>;
	authorizeCurrentSnapshotAtomically(
		command: Readonly<{ truth: SharedControlPanelCurrentTruth; hostNowMs: number }>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelGrant>>;
	createAuthorizedSubscriptionAndAdvanceHeadAtomically(
		command: Readonly<{
			request: SharedControlPanelHostSubscriptionRequest;
			authoritativeBindingFingerprint: string;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelSubscriptionRevision>>;
	claimDueOccurrenceAtomically(
		command: Readonly<{
			subscription: SharedControlPanelSubscriptionRevision;
			occurrenceId: string;
			dueAtMs: number;
			evidenceFingerprint: string;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	materializeAuthorizedCandidateAtomically(
		command: Readonly<{
			occurrence: SharedControlPanelOccurrence;
			candidate: SharedControlPanelCandidate;
			subscription: SharedControlPanelSubscriptionRevision;
			truth: SharedControlPanelCurrentTruth;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	completeVerifiedOccurrenceAtomically(
		command: Readonly<{
			occurrence: SharedControlPanelOccurrence;
			completed: SharedControlPanelCompletedOccurrence;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	evaluateOccurrenceAndRecordDecisionAtomically(
		command: Readonly<{
			occurrence: SharedControlPanelOccurrence;
			completed: SharedControlPanelCompletedOccurrence;
			subscription: SharedControlPanelSubscriptionRevision;
			signal: SharedControlPanelSignal;
			alert: SharedControlPanelAlert | null;
			suppression: SharedControlPanelSuppression | null;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	createAuthorizedInboxDeliveryAtomically(
		command: Readonly<{
			value: SharedControlPanelInboxDelivery;
			truth: SharedControlPanelCurrentTruth;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelInboxDelivery>>;
	transitionAuthorizedInboxDeliveryAtomically(
		command: Readonly<{
			deliveryId: string;
			from: SharedControlPanelInboxDelivery["state"];
			to: SharedControlPanelInboxDelivery["state"];
			truth: SharedControlPanelCurrentTruth;
			hostNowMs: number;
		}>,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelInboxDelivery>>;
	readOrderedAudit(
		command: Readonly<{ tenantId: string }>,
	): Promise<readonly SharedControlPanelAuditEntry[]>;
}

export interface SharedControlPanelAuthorityOptions {
	readonly persistence: SharedControlPanelPersistencePort;
	readonly clock: SharedControlPanelHostClock;
	readonly terminalOutcomeAuthority: SharedControlPanelTerminalOutcomeAuthority;
	readonly subscriptionBindingAuthority: SharedControlPanelSubscriptionBindingAuthority;
}

export interface SharedControlPanelAuthority {
	readonly compatibility: typeof SHARED_CONTROL_PANEL_AUTHORITY_COMPATIBILITY;
	recordCanonicalTruth(
		value: SharedControlPanelCanonicalTruth,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelCanonicalTruth>>;
	recordAdmission(
		value: SharedControlPanelRecordedAdmission,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRecordedAdmission>>;
	recordTerminalOutcome(
		value: SharedControlPanelRecordedTerminalOutcome,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRecordedTerminalOutcome>>;
	recordQueryRerun(
		value: SharedControlPanelQueryRerunRequest,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelQueryRerunRequest>>;
	materializeQueryRerun(
		value: SharedControlPanelQueryRerunRequest,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelCandidate>>;
	createRevision(
		value: SharedControlPanelRevision,
		idempotencyKey: string,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRevision>>;
	reopen(
		tenantId: string,
		workspaceId: string,
		panelId: string,
		panelRevision: string,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRevision>>;
	projectRestricted(
		truth: SharedControlPanelCurrentTruth,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRestrictedProjection>>;
	issueGrant(
		value: SharedControlPanelGrant,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelGrant>>;
	revokeGrant(
		tenantId: string,
		grantId: string,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelGrant>>;
	authorize(
		truth: SharedControlPanelCurrentTruth,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelGrant>>;
	createSubscription(
		request: SharedControlPanelHostSubscriptionRequest,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelSubscriptionRevision>>;
	claimDue(
		subscription: SharedControlPanelSubscriptionRevision,
		occurrenceId: string,
		dueAtMs: number,
		evidenceFingerprint: string,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	materializeCandidate(
		occurrence: SharedControlPanelOccurrence,
		candidate: SharedControlPanelCandidate,
		subscription: SharedControlPanelSubscriptionRevision,
		truth: SharedControlPanelCurrentTruth,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	completeOccurrence(
		occurrence: SharedControlPanelOccurrence,
		completed: SharedControlPanelCompletedOccurrence,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	evaluateOccurrence(
		occurrence: SharedControlPanelOccurrence,
		completed: SharedControlPanelCompletedOccurrence,
		subscription: SharedControlPanelSubscriptionRevision,
		signal: SharedControlPanelSignal,
		alert: SharedControlPanelAlert | null,
		suppression: SharedControlPanelSuppression | null,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	createDelivery(
		value: SharedControlPanelInboxDelivery,
		truth: SharedControlPanelCurrentTruth,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelInboxDelivery>>;
	transitionDelivery(
		deliveryId: string,
		from: SharedControlPanelInboxDelivery["state"],
		to: SharedControlPanelInboxDelivery["state"],
		truth: SharedControlPanelCurrentTruth,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelInboxDelivery>>;
	audit(tenantId: string): Promise<readonly SharedControlPanelAuditEntry[]>;
}

export function createSharedControlPanelAuthority(
	options: SharedControlPanelAuthorityOptions,
): SharedControlPanelAuthority {
	if (!options || typeof options !== "object")
		throw new TypeError("invalid-shared-control-panel-authority-options");
	const { persistence, clock, terminalOutcomeAuthority, subscriptionBindingAuthority } = options;
	if (!persistence || typeof persistence !== "object")
		throw new TypeError("invalid-shared-control-panel-persistence");
	if (typeof persistence.readAdmissionForTerminalOutcome !== "function")
		throw new TypeError("invalid-shared-control-panel-persistence:readAdmissionForTerminalOutcome");
	for (const method of persistenceMethods)
		if (typeof persistence[method] !== "function")
			throw new TypeError(`invalid-shared-control-panel-persistence:${method}`);
	if (!clock || typeof clock.now !== "function")
		throw new TypeError("invalid-shared-control-panel-clock");
	if (!terminalOutcomeAuthority || typeof terminalOutcomeAuthority.lookup !== "function")
		throw new TypeError("invalid-terminal-outcome-authority");
	if (!subscriptionBindingAuthority || typeof subscriptionBindingAuthority.lookup !== "function")
		throw new TypeError("invalid-subscription-binding-authority");
	const hostNow = () => clockNow(clock);
	return {
		compatibility: SHARED_CONTROL_PANEL_AUTHORITY_COMPATIBILITY,
		async recordCanonicalTruth(value) {
			validateCanonicalTruth(value);
			const hostNowMs = hostNow();
			if (value.recordedAtMs !== hostNowMs) return rejectedResult("non-host-truth-time");
			const result = await persistence.recordCanonicalTruthAtomically(
				snapshot({ value, hostNowMs }),
			);
			return checkedResult(result, validateCanonicalTruth);
		},
		async recordAdmission(value) {
			validateRecordedAdmission(value);
			const hostNowMs = hostNow();
			if (value.recordedAtMs !== hostNowMs) return rejectedResult("non-host-admission-time");
			const result = await persistence.recordAdmissionForOccurrenceAtomically(
				snapshot({ value, hostNowMs }),
			);
			return checkedResult(result, validateRecordedAdmission);
		},
		async recordTerminalOutcome(value) {
			validateRecordedTerminalOutcome(value);
			const hostNowMs = hostNow();
			if (value.recordedAtMs !== hostNowMs) return rejectedResult("non-host-outcome-time");
			const admission = await persistence.readAdmissionForTerminalOutcome(
				snapshot({ tenantId: value.tenantId, occurrenceId: value.occurrenceId }),
			);
			if (admission === null)
				return snapshot({ accepted: false, code: "recorded-admission-missing" });
			validateRecordedAdmission(admission);
			if (
				admission.tenantId !== value.tenantId ||
				admission.occurrenceId !== value.occurrenceId ||
				admission.admission.approvedRunId !== value.runId
			)
				return snapshot({ accepted: false, code: "terminal-outcome-run-mismatch" });
			const verifiedRaw = await terminalOutcomeAuthority.lookup(
				snapshot({
					tenantId: value.tenantId,
					occurrenceId: value.occurrenceId,
					admissionId: admission.admission.admissionId,
					approvedRunId: value.runId,
				}),
			);
			if (verifiedRaw === null) return rejectedResult("terminal-outcome-unverified");
			const verified = validateVerifiedTerminalOutcome(verifiedRaw);
			if (!terminalOutcomeMatches(value, verified))
				return snapshot({ accepted: false, code: "terminal-outcome-unverified" });
			const result = await persistence.recordVerifiedTerminalOutcomeAtomically(
				snapshot({ value, verified, hostNowMs }),
			);
			return checkedResult(result, validateRecordedTerminalOutcome);
		},
		async recordQueryRerun(value) {
			validateQueryRerun(value);
			const hostNowMs = hostNow();
			if (value.requestedAtMs !== hostNowMs) return rejectedResult("non-host-rerun-time");
			return checkedResult(
				await persistence.recordQueryRerunAtomically(snapshot({ value, hostNowMs })),
				validateQueryRerun,
			);
		},
		async materializeQueryRerun(value) {
			validateQueryRerun(value);
			const result = await persistence.materializeQueryRerunAtomically(
				snapshot({ value, hostNowMs: hostNow() }),
			);
			return checkedResult(result, validateCandidateValue);
		},
		async createRevision(value, idempotencyKey) {
			validateRevision(value);
			strictIdentity(idempotencyKey);
			const hostNowMs = hostNow();
			if (value.createdAtMs !== hostNowMs) return rejectedResult("non-host-revision-time");
			return checkedResult(
				await persistence.createRevisionAndAdvanceHeadAtomically(
					snapshot({ value, idempotencyKey, hostNowMs }),
				),
				validateRevision,
			);
		},
		async reopen(tenantId, workspaceId, panelId, panelRevision) {
			[tenantId, workspaceId, panelId, panelRevision].forEach(strictIdentity);
			return checkedResult(
				await persistence.reopenCurrentRevisionAtomically(
					snapshot({ tenantId, workspaceId, panelId, panelRevision, hostNowMs: hostNow() }),
				),
				validateRevision,
			);
		},
		async projectRestricted(truth) {
			validateTruth(truth);
			if (!sharedControlPanelCapabilitySupported(truth.capability))
				return rejectedResult("capability-unsupported-v1");
			return checkedResult(
				await persistence.projectAuthorizedRestrictedSnapshotAtomically(
					snapshot({ truth, hostNowMs: hostNow() }),
				),
				validateRestrictedProjection,
			);
		},
		async issueGrant(value) {
			validateGrant(value);
			if (!sharedControlPanelCapabilitySupported(value.capability))
				return rejectedResult("capability-unsupported-v1");
			const hostNowMs = hostNow();
			if (value.issuedAtMs !== hostNowMs) return rejectedResult("non-host-grant-time");
			return checkedResult(
				await persistence.issueGrantAtomically(snapshot({ value, hostNowMs })),
				validateGrant,
			);
		},
		async revokeGrant(tenantId, grantId) {
			strictIdentity(tenantId);
			strictIdentity(grantId);
			const revokedAtMs = hostNow();
			return checkedResult(
				await persistence.revokeGrantAtomically(
					snapshot({ tenantId, grantId, revokedAtMs, hostNowMs: revokedAtMs }),
				),
				validateGrant,
			);
		},
		async authorize(truth) {
			validateTruth(truth);
			if (!sharedControlPanelCapabilitySupported(truth.capability))
				return rejectedResult("capability-unsupported-v1");
			return checkedResult(
				await persistence.authorizeCurrentSnapshotAtomically(
					snapshot({ truth, hostNowMs: hostNow() }),
				),
				validateGrant,
			);
		},
		async createSubscription(request) {
			validateHostSubscriptionRequest(request);
			const hostNowMs = hostNow();
			if (request.admittedAtMs !== hostNowMs || request.revision.effectiveAtMs !== hostNowMs)
				return rejectedResult("non-host-subscription-time");
			const authoritativeRaw = await subscriptionBindingAuthority.lookup(
				snapshot({
					intentId: request.intent.intentId,
					idempotencyKey: request.intent.idempotencyKey,
				}),
			);
			if (authoritativeRaw === null)
				return rejectedResult("subscription-binding-authority-mismatch");
			const authoritative = validateCanvasSubscriptionBinding(authoritativeRaw, request.revision);
			if (canonical(authoritative) !== canonical(request.intent.binding))
				return snapshot({ accepted: false, code: "subscription-binding-authority-mismatch" });
			return checkedResult(
				await persistence.createAuthorizedSubscriptionAndAdvanceHeadAtomically(
					snapshot({
						request,
						authoritativeBindingFingerprint: request.bindingAuthorityFingerprint,
						hostNowMs,
					}),
				),
				validateSubscription,
			);
		},
		async claimDue(subscription, occurrenceId, dueAtMs, evidenceFingerprint) {
			validateSubscription(subscription);
			strictIdentity(occurrenceId);
			strictTimestamp(dueAtMs);
			strictIdentity(evidenceFingerprint);
			return checkedResult(
				await persistence.claimDueOccurrenceAtomically(
					snapshot({
						subscription,
						occurrenceId,
						dueAtMs,
						evidenceFingerprint,
						hostNowMs: hostNow(),
					}),
				),
				validateOccurrence,
			);
		},
		async materializeCandidate(occurrence, candidate, subscription, truth) {
			validateOccurrence(occurrence);
			validateCandidate(candidate, occurrence, candidate.createdAtMs);
			validateSubscription(subscription);
			validateTruth(truth);
			const hostNowMs = hostNow();
			if (candidate.createdAtMs !== hostNowMs) return rejectedResult("non-host-candidate-time");
			return checkedResult(
				await persistence.materializeAuthorizedCandidateAtomically(
					snapshot({ occurrence, candidate, subscription, truth, hostNowMs }),
				),
				validateOccurrence,
			);
		},
		async completeOccurrence(occurrence, completed) {
			validateOccurrence(occurrence);
			validateCompleted(completed, occurrence, completed.completedAtMs);
			const hostNowMs = hostNow();
			if (completed.completedAtMs !== hostNowMs) return rejectedResult("non-host-completion-time");
			return checkedResult(
				await persistence.completeVerifiedOccurrenceAtomically(
					snapshot({ occurrence, completed, hostNowMs }),
				),
				validateOccurrence,
			);
		},
		async evaluateOccurrence(occurrence, completed, subscription, signal, alert, suppression) {
			validateOccurrence(occurrence);
			validateCompleted(completed, occurrence, completed.completedAtMs);
			validateSubscription(subscription);
			validateSignal(signal);
			if (alert) validateAlert(alert, occurrence, signal, alert.createdAtMs, subscription);
			if (suppression)
				validateSuppression(suppression, occurrence, signal, subscription, suppression.createdAtMs);
			const hostNowMs = hostNow();
			if (
				(alert?.createdAtMs !== undefined && alert.createdAtMs !== hostNowMs) ||
				(suppression?.createdAtMs !== undefined && suppression.createdAtMs !== hostNowMs)
			)
				return rejectedResult("non-host-evaluation-time");
			return checkedResult(
				await persistence.evaluateOccurrenceAndRecordDecisionAtomically(
					snapshot({
						occurrence,
						completed,
						subscription,
						signal,
						alert,
						suppression,
						hostNowMs,
					}),
				),
				validateOccurrence,
			);
		},
		async createDelivery(value, truth) {
			validateDelivery(value);
			validateTruth(truth);
			const hostNowMs = hostNow();
			if (value.createdAtMs !== hostNowMs) return rejectedResult("non-host-delivery-time");
			return checkedResult(
				await persistence.createAuthorizedInboxDeliveryAtomically(
					snapshot({ value, truth, hostNowMs }),
				),
				validateDelivery,
			);
		},
		async transitionDelivery(deliveryId, from, to, truth) {
			strictIdentity(deliveryId);
			validateDeliveryState(from);
			validateDeliveryState(to);
			validateTruth(truth);
			return checkedResult(
				await persistence.transitionAuthorizedInboxDeliveryAtomically(
					snapshot({ deliveryId, from, to, truth, hostNowMs: hostNow() }),
				),
				validateDelivery,
			);
		},
		async audit(tenantId) {
			strictIdentity(tenantId);
			const result = await persistence.readOrderedAudit(snapshot({ tenantId }));
			if (!Array.isArray(result)) throw new TypeError("invalid-shared-control-panel-audit-result");
			let prior = 0;
			return snapshot(
				result.map((entry) => {
					const valid = validateAudit(entry);
					if (valid.tenantId !== tenantId || valid.sequence <= prior)
						throw new TypeError("unordered-shared-control-panel-audit");
					prior = valid.sequence;
					return valid;
				}),
			);
		},
	};
}

const persistenceMethods = [
	"recordCanonicalTruthAtomically",
	"recordAdmissionForOccurrenceAtomically",
	"recordVerifiedTerminalOutcomeAtomically",
	"recordQueryRerunAtomically",
	"materializeQueryRerunAtomically",
	"createRevisionAndAdvanceHeadAtomically",
	"reopenCurrentRevisionAtomically",
	"projectAuthorizedRestrictedSnapshotAtomically",
	"issueGrantAtomically",
	"revokeGrantAtomically",
	"authorizeCurrentSnapshotAtomically",
	"createAuthorizedSubscriptionAndAdvanceHeadAtomically",
	"claimDueOccurrenceAtomically",
	"materializeAuthorizedCandidateAtomically",
	"completeVerifiedOccurrenceAtomically",
	"evaluateOccurrenceAndRecordDecisionAtomically",
	"createAuthorizedInboxDeliveryAtomically",
	"transitionAuthorizedInboxDeliveryAtomically",
	"readOrderedAudit",
] as const;

function checkedResult<T>(
	result: SharedControlPanelStoreResult<T>,
	validate: (value: T) => unknown,
): SharedControlPanelStoreResult<T> {
	if (
		!result ||
		typeof result !== "object" ||
		Object.getPrototypeOf(result) !== Object.prototype ||
		typeof result.accepted !== "boolean" ||
		typeof result.code !== "string" ||
		result.code.length === 0
	)
		throw new TypeError("invalid-shared-control-panel-persistence-result");
	for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(result)))
		if ("get" in descriptor || "set" in descriptor)
			throw new TypeError("accessor-shared-control-panel-persistence-result");
	const expectedKeys = result.accepted ? ["accepted", "code", "value"] : ["accepted", "code"];
	if (
		Object.keys(result).length !== expectedKeys.length ||
		Object.keys(result).some((key) => !expectedKeys.includes(key))
	)
		throw new TypeError("unknown-shared-control-panel-persistence-result-field");
	if (result.accepted) {
		if (!("value" in result)) throw new TypeError("missing-shared-control-panel-persistence-value");
		validate(result.value as T);
	} else if ("value" in result)
		throw new TypeError("rejected-shared-control-panel-result-has-value");
	return snapshot(result);
}
function rejectedResult<T = never>(code: string): SharedControlPanelStoreResult<T> {
	return snapshot({ accepted: false, code });
}
function validateVerifiedTerminalOutcome(
	value: SharedControlPanelVerifiedTerminalOutcome,
): SharedControlPanelVerifiedTerminalOutcome {
	if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
		throw new TypeError("invalid-verified-terminal-outcome");
	for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))
		if ("get" in descriptor || "set" in descriptor)
			throw new TypeError("accessor-shared-control-panel-material");
	const keys = [
		"runId",
		"attempt",
		"outcomeId",
		"terminalHighWater",
		"outcomeEvidenceFingerprint",
		"evidenceRefs",
	];
	if (
		Object.keys(value).length !== keys.length ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		throw new TypeError("invalid-verified-terminal-outcome");
	strictIdentity(value.runId);
	strictIdentity(value.outcomeId);
	strictIdentity(value.outcomeEvidenceFingerprint);
	if (!Number.isSafeInteger(value.attempt) || !Number.isSafeInteger(value.terminalHighWater))
		throw new TypeError("invalid-verified-terminal-outcome");
	if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 32)
		throw new TypeError("invalid-verified-terminal-outcome");
	for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value.evidenceRefs)))
		if ("get" in descriptor || "set" in descriptor)
			throw new TypeError("accessor-shared-control-panel-material");
	for (let index = 0; index < value.evidenceRefs.length; index++)
		if (!Object.hasOwn(value.evidenceRefs, index))
			throw new TypeError("invalid-verified-terminal-outcome");
	for (const ref of value.evidenceRefs) {
		if (!ref || typeof ref !== "object" || Object.getPrototypeOf(ref) !== Object.prototype)
			throw new TypeError("invalid-verified-terminal-outcome");
		for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(ref)))
			if ("get" in descriptor || "set" in descriptor)
				throw new TypeError("accessor-shared-control-panel-material");
		if (Object.keys(ref).length !== 2) throw new TypeError("invalid-verified-terminal-outcome");
		strictIdentity(ref.kind);
		strictIdentity(ref.id);
	}
	return snapshot(value);
}
function validateCandidateValue(value: SharedControlPanelCandidate) {
	const occurrence: SharedControlPanelOccurrence = {
		kind: "shared-control-panel-occurrence",
		tenantId: "validation",
		occurrenceId: value.occurrenceId,
		subscriptionId: "validation",
		subscriptionRevision: "validation",
		conditionRevision: "validation",
		panelId: "validation",
		panelRevision: "validation",
		dueAtMs: value.createdAtMs,
		claimedAtMs: value.createdAtMs,
		admissionFingerprint: "validation",
		state: "claimed",
		reason: "validation",
		candidate: null,
		completed: null,
		evaluation: null,
	};
	validateCandidate(value, occurrence, value.createdAtMs);
}
function terminalAdmissionId(value: SharedControlPanelRecordedTerminalOutcome) {
	const ref = value.evidenceRefs.find((item) => item.kind === "tool-provider-run-admission");
	return ref?.id ?? value.occurrenceId;
}
function terminalOutcomeMatches(
	value: SharedControlPanelRecordedTerminalOutcome,
	verified: SharedControlPanelVerifiedTerminalOutcome,
) {
	return sharedControlPanelRecordedOutcomeMatchesCompleted(value, {
		kind: "shared-control-panel-completed-occurrence",
		occurrenceId: value.occurrenceId,
		candidateRequestId: "verified",
		candidateRunId: "verified",
		admissionId: terminalAdmissionId(value),
		admissionSourceRefs: [{ kind: "tool-provider-run-admission", id: terminalAdmissionId(value) }],
		runId: verified.runId,
		attempt: verified.attempt,
		outcomeId: verified.outcomeId,
		terminalHighWater: verified.terminalHighWater,
		outcomeEvidenceFingerprint: verified.outcomeEvidenceFingerprint,
		evidenceRefs: verified.evidenceRefs,
		completedAtMs: value.recordedAtMs,
	});
}
function strictIdentity(value: unknown) {
	if (typeof value !== "string" || value.length === 0 || value.length > 512)
		throw new TypeError("invalid-shared-control-panel-identity");
}
function strictTimestamp(value: number) {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("invalid-timestamp");
}
function validateDeliveryState(value: string) {
	if (!["pending", "attempted", "delivered", "failed", "suppressed", "expired"].includes(value))
		throw new TypeError("invalid-delivery-state");
}
