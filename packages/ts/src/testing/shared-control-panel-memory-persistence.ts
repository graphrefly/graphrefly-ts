/** Reference-only in-memory persistence for D609 backend conformance tests. */
import type { SharedControlPanelPersistencePort } from "../solutions/shared-control-panel-authority.js";
import type {
	SharedControlPanelAlert,
	SharedControlPanelAuditEntry,
	SharedControlPanelCanonicalTruth,
	SharedControlPanelGrant,
	SharedControlPanelInboxDelivery,
	SharedControlPanelOccurrence,
	SharedControlPanelRecordedAdmission,
	SharedControlPanelRevision,
	SharedControlPanelSubscriptionRevision,
} from "../solutions/shared-control-panel-contracts.js";
import {
	canonical,
	evaluationDecisionFingerprint,
	rejected,
	sharedControlPanelCompletedOccurrenceCorrelates,
	sharedControlPanelConditionMatches,
	sharedControlPanelRecordedOutcomeMatchesCompleted,
	snapshot,
	validateAlert,
	validateCanonicalTruth,
	validateDelivery,
	validateGrant,
	validateRecordedAdmission,
	validateRevision,
	validateSubscription,
} from "../solutions/shared-control-panel-contracts.js";

type Command<M extends keyof SharedControlPanelPersistencePort> = Parameters<
	SharedControlPanelPersistencePort[M]
>[0];
const joined = (...parts: readonly (string | number)[]) => parts.join("\u001f");

interface MemoryState {
	canonicalTruth: Map<string, SharedControlPanelCanonicalTruth>;
	revisions: Map<string, SharedControlPanelRevision>;
	revisionIdempotency: Map<string, string>;
	panelHeads: Map<string, string>;
	grants: Map<string, SharedControlPanelGrant>;
	subscriptionRequests: Map<string, unknown>;
	subscriptions: Map<string, SharedControlPanelSubscriptionRevision>;
	subscriptionActions: Map<string, "create" | "pause" | "resume" | "revoke">;
	subscriptionHeads: Map<string, string>;
	occurrences: Map<string, SharedControlPanelOccurrence>;
	occurrenceIds: Map<string, string>;
	admissions: Map<string, SharedControlPanelRecordedAdmission>;
	outcomes: Map<string, unknown>;
	reruns: Map<string, unknown>;
	rerunIds: Map<string, string>;
	materializedReruns: Set<string>;
	alerts: Map<string, SharedControlPanelAlert>;
	alertEvidence: Map<string, string>;
	suppressions: Map<string, unknown>;
	deliveries: Map<string, SharedControlPanelInboxDelivery>;
	audits: SharedControlPanelAuditEntry[];
	sequence: number;
}

const initialState = (): MemoryState => ({
	canonicalTruth: new Map(),
	revisions: new Map(),
	revisionIdempotency: new Map(),
	panelHeads: new Map(),
	grants: new Map(),
	subscriptionRequests: new Map(),
	subscriptions: new Map(),
	subscriptionActions: new Map(),
	subscriptionHeads: new Map(),
	occurrences: new Map(),
	occurrenceIds: new Map(),
	admissions: new Map(),
	outcomes: new Map(),
	reruns: new Map(),
	rerunIds: new Map(),
	materializedReruns: new Set(),
	alerts: new Map(),
	alertEvidence: new Map(),
	suppressions: new Map(),
	deliveries: new Map(),
	audits: [],
	sequence: 0,
});
const cloneState = (state: MemoryState): MemoryState => structuredClone(state);
const accepted = <T>(code: string, value: T) => snapshot({ accepted: true as const, code, value });
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);

export interface SharedControlPanelMemoryPersistence extends SharedControlPanelPersistencePort {
	/** Test-only fault injection: the next atomic write rolls back after its reducer succeeds. */
	failNextCommit(): void;
}

export function createSharedControlPanelMemoryPersistence(): SharedControlPanelMemoryPersistence {
	let state = initialState();
	let tail = Promise.resolve();
	let failCommit = false;
	async function atomic<T>(work: (draft: MemoryState) => T | Promise<T>): Promise<T> {
		const prior = tail;
		let release!: () => void;
		tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await prior;
		const draft = cloneState(state);
		try {
			const result = await work(draft);
			if (failCommit) {
				failCommit = false;
				throw new Error("shared-control-panel-memory-commit-failed");
			}
			state = draft;
			return snapshot(result);
		} finally {
			release();
		}
	}
	function audit(
		draft: MemoryState,
		tenantId: string,
		subjectId: string,
		objectId: string,
		eventKind: string,
		at: number,
	) {
		const sequence = ++draft.sequence;
		draft.audits.push(
			snapshot({
				kind: "shared-control-panel-audit",
				tenantId,
				sequence,
				eventId: `${eventKind}:${objectId}:${at}`,
				eventKind,
				subjectId,
				objectId,
				occurredAtMs: at,
			}),
		);
	}
	function authorization(
		draft: MemoryState,
		truth: Command<"authorizeCurrentSnapshotAtomically">["truth"],
		at: number,
	) {
		const panelKey = joined(truth.pins.tenantId, truth.pins.panelId);
		const revision = draft.revisions.get(joined(panelKey, truth.pins.panelRevision));
		const current = draft.canonicalTruth.get(panelKey);
		const grant = draft.grants.get(joined(truth.pins.tenantId, truth.grantId));
		if (
			!revision ||
			draft.panelHeads.get(panelKey) !== truth.pins.panelRevision ||
			!current ||
			!grant
		)
			return rejected<SharedControlPanelGrant>("grant-or-current-panel-missing");
		if (
			!same(revision.pins, truth.pins) ||
			!same(current.pins, truth.pins) ||
			grant.panelId !== truth.pins.panelId ||
			grant.panelRevision !== truth.pins.panelRevision ||
			grant.subjectId !== truth.subjectId ||
			grant.capability !== truth.capability ||
			grant.capabilityRevision !== truth.capabilityRevision ||
			grant.actorSessionRevision !== truth.actorSessionRevision ||
			grant.policyRevision !== truth.currentPolicyRevision ||
			grant.redactionRevision !== truth.currentRedactionRevision ||
			grant.revokedAtMs !== null ||
			at < grant.issuedAtMs ||
			at >= grant.expiresAtMs
		)
			return rejected<SharedControlPanelGrant>("authorization-stale-or-denied");
		return accepted("authorized", grant);
	}
	function occurrenceKey(
		value: Pick<
			SharedControlPanelOccurrence,
			"tenantId" | "subscriptionId" | "subscriptionRevision" | "dueAtMs"
		>,
	) {
		return joined(value.tenantId, value.subscriptionId, value.subscriptionRevision, value.dueAtMs);
	}
	function currentOccurrence(draft: MemoryState, value: SharedControlPanelOccurrence) {
		const stored = draft.occurrences.get(occurrenceKey(value));
		return stored && same(stored, value) ? stored : null;
	}
	function replaceOccurrence(
		draft: MemoryState,
		prior: SharedControlPanelOccurrence,
		next: SharedControlPanelOccurrence,
		at: number,
	) {
		draft.occurrences.set(occurrenceKey(prior), snapshot(next));
		audit(draft, prior.tenantId, "host", prior.occurrenceId, next.state, at);
		return accepted(next.state, next);
	}

	return {
		failNextCommit() {
			failCommit = true;
		},
		async recordCanonicalTruthAtomically(command) {
			return atomic((draft) => {
				validateCanonicalTruth(command.value);
				const k = joined(command.value.pins.tenantId, command.value.pins.panelId);
				const old = draft.canonicalTruth.get(k);
				if (old && same(old, command.value)) return accepted("canonical-truth-rereferenced", old);
				if (
					old &&
					(!same(scope(old), scope(command.value)) ||
						command.value.pins.runHighWater < old.pins.runHighWater ||
						command.value.pins.evidenceHighWater < old.pins.evidenceHighWater ||
						command.value.pins.freshnessHighWater < old.pins.freshnessHighWater ||
						command.value.pins.attempt < old.pins.attempt ||
						(command.value.pins.runHighWater === old.pins.runHighWater &&
							command.value.pins.evidenceHighWater === old.pins.evidenceHighWater &&
							command.value.pins.freshnessHighWater === old.pins.freshnessHighWater &&
							command.value.pins.attempt === old.pins.attempt))
				)
					return rejected("canonical-truth-cas-conflict");
				draft.canonicalTruth.set(k, snapshot(command.value));
				audit(
					draft,
					command.value.pins.tenantId,
					"host",
					command.value.pins.panelId,
					"canonical-truth-recorded",
					command.hostNowMs,
				);
				return accepted("canonical-truth-recorded", command.value);
			});
		},
		async recordAdmissionForOccurrenceAtomically(command) {
			return atomic((draft) => {
				validateRecordedAdmission(command.value);
				const ownerKey = draft.occurrenceIds.get(
					joined(command.value.tenantId, command.value.occurrenceId),
				);
				const owner = ownerKey ? draft.occurrences.get(ownerKey) : undefined;
				if (!owner) return rejected("admission-owner-missing");
				if (
					owner.state !== "candidate-created" ||
					owner.candidate?.request.requestId !== command.value.admission.requestId ||
					owner.candidate.request.runId !== command.value.admission.runId
				)
					return rejected("admission-owner-mismatch");
				const k = joined(command.value.tenantId, command.value.occurrenceId);
				const old = draft.admissions.get(k);
				if (old)
					return same(old, command.value)
						? accepted("admission-rereferenced", old)
						: rejected("admission-conflict");
				draft.admissions.set(k, snapshot(command.value));
				audit(
					draft,
					command.value.tenantId,
					"host",
					command.value.occurrenceId,
					"admission-recorded",
					command.hostNowMs,
				);
				return accepted("admission-recorded", command.value);
			});
		},
		async readAdmissionForTerminalOutcome(command) {
			return atomic(
				(draft) => draft.admissions.get(joined(command.tenantId, command.occurrenceId)) ?? null,
			);
		},
		async recordVerifiedTerminalOutcomeAtomically(command) {
			return atomic((draft) => {
				const admission = draft.admissions.get(
					joined(command.value.tenantId, command.value.occurrenceId),
				);
				if (!admission) return rejected("recorded-admission-missing");
				if (
					admission.admission.approvedRunId !== command.value.runId ||
					!same(command.verified, {
						runId: command.value.runId,
						attempt: command.value.attempt,
						outcomeId: command.value.outcomeId,
						terminalHighWater: command.value.terminalHighWater,
						outcomeEvidenceFingerprint: command.value.outcomeEvidenceFingerprint,
						evidenceRefs: command.value.evidenceRefs,
					})
				)
					return rejected("terminal-outcome-unverified");
				const k = joined(command.value.tenantId, command.value.occurrenceId, command.value.runId);
				const old = draft.outcomes.get(k);
				if (old)
					return same(old, command.value)
						? accepted("terminal-outcome-rereferenced", old as typeof command.value)
						: rejected("terminal-outcome-conflict");
				draft.outcomes.set(k, snapshot(command.value));
				audit(
					draft,
					command.value.tenantId,
					"host",
					command.value.occurrenceId,
					"terminal-outcome-recorded",
					command.hostNowMs,
				);
				return accepted("terminal-outcome-recorded", command.value);
			});
		},
		async recordQueryRerunAtomically(command) {
			return atomic((draft) => {
				const auth = authorization(draft, command.value.truth, command.hostNowMs);
				if (!auth.accepted || command.value.truth.capability !== "query-rerun")
					return rejected("authorization-stale-or-denied");
				const tenant = command.value.truth.pins.tenantId;
				const byId = joined(tenant, command.value.rerunId);
				const byKey = joined(tenant, command.value.idempotencyKey);
				const priorId = draft.rerunIds.get(byId) ?? draft.rerunIds.get(byKey);
				const prior = priorId ? draft.reruns.get(priorId) : undefined;
				if (prior)
					return same(prior, command.value)
						? accepted("query-rerun-rereferenced", prior as typeof command.value)
						: rejected("query-rerun-conflict");
				draft.reruns.set(byId, snapshot(command.value));
				draft.rerunIds.set(byId, byId);
				draft.rerunIds.set(byKey, byId);
				audit(
					draft,
					tenant,
					command.value.truth.subjectId,
					command.value.rerunId,
					"query-rerun-recorded",
					command.hostNowMs,
				);
				return accepted("query-rerun-recorded", command.value);
			});
		},
		async materializeQueryRerunAtomically(command) {
			return atomic((draft) => {
				const auth = authorization(draft, command.value.truth, command.hostNowMs);
				if (!auth.accepted || command.value.truth.capability !== "query-rerun")
					return rejected("authorization-stale-or-denied");
				const id = joined(command.value.truth.pins.tenantId, command.value.rerunId);
				const stored = draft.reruns.get(id);
				if (!stored || !same(stored, command.value))
					return rejected("query-rerun-missing-or-conflict");
				if (draft.materializedReruns.has(id))
					return accepted("query-rerun-rereferenced", command.value.candidate);
				draft.materializedReruns.add(id);
				audit(
					draft,
					command.value.truth.pins.tenantId,
					command.value.truth.subjectId,
					command.value.rerunId,
					"query-rerun-materialized",
					command.hostNowMs,
				);
				return accepted("query-rerun-materialized", command.value.candidate);
			});
		},
		async createRevisionAndAdvanceHeadAtomically(command) {
			return atomic((draft) => {
				validateRevision(command.value);
				const base = joined(command.value.pins.tenantId, command.value.pins.panelId);
				const idem = joined(base, command.idempotencyKey);
				const priorRevision = draft.revisionIdempotency.get(idem);
				if (priorRevision) {
					const old = draft.revisions.get(joined(base, priorRevision));
					return old && same(old, command.value)
						? accepted("panel-revision-rereferenced", old)
						: rejected("panel-idempotency-conflict");
				}
				if ((draft.panelHeads.get(base) ?? null) !== command.value.previousRevision)
					return rejected("panel-head-conflict");
				const revisionKey = joined(base, command.value.pins.panelRevision);
				if (draft.revisions.has(revisionKey)) return rejected("panel-revision-conflict");
				draft.revisions.set(revisionKey, snapshot(command.value));
				draft.revisionIdempotency.set(idem, command.value.pins.panelRevision);
				draft.panelHeads.set(base, command.value.pins.panelRevision);
				audit(
					draft,
					command.value.pins.tenantId,
					command.value.createdBy,
					command.value.pins.panelId,
					"panel-revision-created",
					command.hostNowMs,
				);
				return accepted("panel-revision-created", command.value);
			});
		},
		async reopenCurrentRevisionAtomically(command) {
			return atomic((draft) => {
				const base = joined(command.tenantId, command.panelId);
				if (draft.panelHeads.get(base) !== command.panelRevision)
					return rejected("panel-head-conflict");
				const revision = draft.revisions.get(joined(base, command.panelRevision));
				if (!revision || revision.pins.workspaceId !== command.workspaceId)
					return rejected("panel-revision-missing");
				const truth = draft.canonicalTruth.get(base);
				if (!truth || !same(truth.pins, revision.pins)) return rejected("canonical-truth-stale");
				return accepted("panel-reopened", revision);
			});
		},
		async projectAuthorizedRestrictedSnapshotAtomically(command) {
			return atomic((draft) => {
				const auth = authorization(draft, command.truth, command.hostNowMs);
				if (!auth.accepted || command.truth.capability !== "view")
					return rejected("authorization-stale-or-denied");
				audit(
					draft,
					command.truth.pins.tenantId,
					command.truth.subjectId,
					command.truth.grantId,
					"capability-admitted:view",
					command.hostNowMs,
				);
				const revision = draft.revisions.get(
					joined(
						command.truth.pins.tenantId,
						command.truth.pins.panelId,
						command.truth.pins.panelRevision,
					),
				)!;
				return accepted("restricted-projection", {
					kind: "shared-control-panel-restricted-projection" as const,
					grantId: command.truth.grantId,
					tenantId: command.truth.pins.tenantId,
					workspaceId: command.truth.pins.workspaceId,
					panelId: command.truth.pins.panelId,
					panelRevision: command.truth.pins.panelRevision,
					workGraphId: command.truth.pins.workGraphId,
					subjectId: command.truth.subjectId,
					capability: command.truth.capability,
					policyRevision: command.truth.currentPolicyRevision,
					redactionRevision: command.truth.currentRedactionRevision,
					frameIds: revision.frames.map((x) => x.frameId),
					widgetIds: revision.widgets.map((x) => x.widgetId),
				});
			});
		},
		async issueGrantAtomically(command) {
			return atomic((draft) => {
				validateGrant(command.value);
				const panel = joined(command.value.tenantId, command.value.panelId);
				if (draft.panelHeads.get(panel) !== command.value.panelRevision)
					return rejected("panel-head-conflict");
				const k = joined(command.value.tenantId, command.value.grantId);
				const old = draft.grants.get(k);
				if (old)
					return same(old, command.value)
						? accepted("grant-rereferenced", old)
						: rejected("grant-conflict");
				draft.grants.set(k, snapshot(command.value));
				audit(
					draft,
					command.value.tenantId,
					command.value.subjectId,
					command.value.grantId,
					"grant-issued",
					command.hostNowMs,
				);
				return accepted("grant-issued", command.value);
			});
		},
		async revokeGrantAtomically(command) {
			return atomic((draft) => {
				const k = joined(command.tenantId, command.grantId);
				const old = draft.grants.get(k);
				if (!old) return rejected("grant-missing");
				if (old.revokedAtMs !== null)
					return old.revokedAtMs === command.revokedAtMs
						? accepted("grant-rereferenced", old)
						: rejected("grant-conflict");
				const next = snapshot({ ...old, revokedAtMs: command.revokedAtMs });
				draft.grants.set(k, next);
				audit(
					draft,
					command.tenantId,
					old.subjectId,
					old.grantId,
					"grant-revoked",
					command.hostNowMs,
				);
				return accepted("grant-revoked", next);
			});
		},
		async authorizeCurrentSnapshotAtomically(command) {
			return atomic((draft) => {
				const result = authorization(draft, command.truth, command.hostNowMs);
				if (result.accepted) {
					audit(
						draft,
						command.truth.pins.tenantId,
						command.truth.subjectId,
						command.truth.grantId,
						"authorization-admitted",
						command.hostNowMs,
					);
				}
				return result;
			});
		},
		async createAuthorizedSubscriptionAndAdvanceHeadAtomically(command) {
			return atomic((draft) => {
				const revision = command.request.revision;
				validateSubscription(revision);
				const truth = subscriptionTruth(revision, command.hostNowMs);
				const auth = authorization(draft, truth, command.hostNowMs);
				if (!auth.accepted) return rejected("authorization-stale-or-denied");
				const requestKey = joined(revision.tenantId, command.request.intent.idempotencyKey);
				const oldRequest = draft.subscriptionRequests.get(requestKey);
				if (oldRequest)
					return same(oldRequest, command.request)
						? accepted("subscription-rereferenced", revision)
						: rejected("subscription-request-conflict");
				const base = joined(revision.tenantId, revision.subscriptionId);
				if ((draft.subscriptionHeads.get(base) ?? null) !== revision.previousRevision)
					return rejected("stale-subscription-head");
				if (command.request.intent.action !== "create") {
					const previousKey = joined(base, revision.previousRevision ?? "");
					const previous = draft.subscriptions.get(previousKey);
					if (!previous) return rejected("current-subscription-missing");
					if (draft.subscriptionActions.get(previousKey) === "revoke")
						return rejected("subscription-revoked");
					if (
						(command.request.intent.action === "pause" && !previous.active) ||
						(command.request.intent.action === "resume" && previous.active)
					)
						return rejected("invalid-subscription-transition");
				}
				const bodyKey = joined(base, revision.subscriptionRevision);
				if (draft.subscriptions.has(bodyKey)) return rejected("subscription-conflict");
				draft.subscriptionRequests.set(requestKey, snapshot(command.request));
				draft.subscriptions.set(bodyKey, snapshot(revision));
				draft.subscriptionActions.set(bodyKey, command.request.intent.action);
				draft.subscriptionHeads.set(base, revision.subscriptionRevision);
				audit(
					draft,
					revision.tenantId,
					revision.subjectId,
					revision.subscriptionId,
					"subscription-created",
					command.hostNowMs,
				);
				return accepted("subscription-created", revision);
			});
		},
		async claimDueOccurrenceAtomically(command) {
			return atomic((draft) => {
				const sub = command.subscription;
				validateSubscription(sub);
				const base = joined(sub.tenantId, sub.subscriptionId);
				const current = draft.subscriptions.get(
					joined(base, draft.subscriptionHeads.get(base) ?? ""),
				);
				if (!current || !same(current, sub)) return rejected("stale-subscription-revision");
				const auth = authorization(
					draft,
					subscriptionTruth(sub, command.hostNowMs),
					command.hostNowMs,
				);
				if (!auth.accepted || !sub.active || command.hostNowMs >= sub.expiresAtMs)
					return rejected("authorization-stale-or-denied");
				if (
					command.hostNowMs < command.dueAtMs ||
					command.dueAtMs < sub.scheduleAnchorMs ||
					(command.dueAtMs - sub.scheduleAnchorMs) % sub.intervalMs !== 0
				)
					return rejected("occurrence-not-due");
				const occurrence: SharedControlPanelOccurrence = {
					kind: "shared-control-panel-occurrence",
					tenantId: sub.tenantId,
					occurrenceId: command.occurrenceId,
					subscriptionId: sub.subscriptionId,
					subscriptionRevision: sub.subscriptionRevision,
					conditionRevision: sub.conditionRevision,
					panelId: sub.panelId,
					panelRevision: sub.panelRevision,
					dueAtMs: command.dueAtMs,
					claimedAtMs: command.hostNowMs,
					admissionFingerprint: command.evidenceFingerprint,
					state: "claimed",
					reason: "due",
					candidate: null,
					completed: null,
					evaluation: null,
				};
				const k = occurrenceKey(occurrence);
				const id = joined(sub.tenantId, command.occurrenceId);
				const existingKey = draft.occurrenceIds.get(id);
				const old =
					draft.occurrences.get(k) ??
					(existingKey ? draft.occurrences.get(existingKey) : undefined);
				if (old)
					return same(old, occurrence)
						? accepted("occurrence-rereferenced", old)
						: rejected("occurrence-conflict");
				draft.occurrences.set(k, snapshot(occurrence));
				draft.occurrenceIds.set(id, k);
				audit(
					draft,
					sub.tenantId,
					sub.subjectId,
					occurrence.occurrenceId,
					"occurrence-claimed",
					command.hostNowMs,
				);
				return accepted("occurrence-claimed", occurrence);
			});
		},
		async materializeAuthorizedCandidateAtomically(command) {
			return atomic((draft) => {
				const subBase = joined(command.subscription.tenantId, command.subscription.subscriptionId);
				const storedSubscription = draft.subscriptions.get(
					joined(subBase, draft.subscriptionHeads.get(subBase) ?? ""),
				);
				if (!storedSubscription || !same(storedSubscription, command.subscription))
					return rejected("stale-subscription-revision");
				if (
					command.occurrence.subscriptionId !== storedSubscription.subscriptionId ||
					command.occurrence.subscriptionRevision !== storedSubscription.subscriptionRevision ||
					command.occurrence.conditionRevision !== storedSubscription.conditionRevision ||
					command.occurrence.panelId !== storedSubscription.panelId ||
					command.occurrence.panelRevision !== storedSubscription.panelRevision ||
					!same(command.truth, subscriptionTruth(storedSubscription, command.truth.observedAtMs)) ||
					!candidateMatchesSubscription(command.candidate, command.occurrence, storedSubscription)
				)
					return rejected("candidate-subscription-binding-mismatch");
				const auth = authorization(draft, command.truth, command.hostNowMs);
				if (!auth.accepted || command.truth.capability !== "subscribe")
					return rejected("authorization-stale-or-denied");
				const old = currentOccurrence(draft, command.occurrence);
				if (!old || old.state !== "claimed") return rejected("stale-occurrence");
				const next = snapshot({
					...old,
					candidate: command.candidate,
					state: "candidate-created" as const,
					reason: "candidate-created",
				});
				return replaceOccurrence(draft, old, next, command.hostNowMs);
			});
		},
		async completeVerifiedOccurrenceAtomically(command) {
			return atomic((draft) => {
				const old = currentOccurrence(draft, command.occurrence);
				if (!old || old.state !== "candidate-created") return rejected("stale-occurrence");
				const admission = draft.admissions.get(joined(old.tenantId, old.occurrenceId));
				const outcome = draft.outcomes.get(
					joined(old.tenantId, old.occurrenceId, command.completed.runId),
				);
				if (!admission || !outcome) return rejected("terminal-outcome-missing");
				if (
					admission.admission.admissionId !== command.completed.admissionId ||
					!sharedControlPanelCompletedOccurrenceCorrelates(old, command.completed) ||
					!sharedControlPanelRecordedOutcomeMatchesCompleted(
						outcome as Parameters<typeof sharedControlPanelRecordedOutcomeMatchesCompleted>[0],
						command.completed,
					)
				)
					return rejected("completed-occurrence-correlation-mismatch");
				const next = snapshot({
					...old,
					completed: command.completed,
					state: "completed" as const,
					reason: "completed",
				});
				return replaceOccurrence(draft, old, next, command.hostNowMs);
			});
		},
		async evaluateOccurrenceAndRecordDecisionAtomically(command) {
			return atomic((draft) => {
				const subBase = joined(command.subscription.tenantId, command.subscription.subscriptionId);
				const storedSubscription = draft.subscriptions.get(
					joined(subBase, draft.subscriptionHeads.get(subBase) ?? ""),
				);
				if (!storedSubscription || !same(storedSubscription, command.subscription))
					return rejected("stale-subscription-revision");
				const auth = authorization(
					draft,
					subscriptionTruth(storedSubscription, command.hostNowMs),
					command.hostNowMs,
				);
				const verifiedOutcome = draft.outcomes.get(
					joined(
						command.occurrence.tenantId,
						command.occurrence.occurrenceId,
						command.completed.runId,
					),
				);
				if (
					!auth.accepted ||
					!verifiedOutcome ||
					!sharedControlPanelRecordedOutcomeMatchesCompleted(
						verifiedOutcome as Parameters<
							typeof sharedControlPanelRecordedOutcomeMatchesCompleted
						>[0],
						command.completed,
					) ||
					command.signal.evidenceFingerprint !== command.completed.outcomeEvidenceFingerprint ||
					!same(command.signal.evidenceRefs, command.completed.evidenceRefs)
				)
					return rejected("evaluation-correlation-mismatch");
				const stored = draft.occurrences.get(occurrenceKey(command.occurrence));
				if (command.occurrence.state === "evaluated") {
					if (!stored || !same(stored, command.occurrence)) return rejected("stale-occurrence");
					if (
						command.occurrence.evaluation?.decisionFingerprint !==
						evaluationDecisionFingerprint(
							command.subscription,
							command.signal,
							command.alert,
							command.suppression,
						)
					)
						return rejected("evaluation-rereference-conflict");
					return accepted("evaluation-rereferenced", command.occurrence);
				}
				const old = currentOccurrence(draft, command.occurrence);
				if (!old || old.state !== "completed" || !same(old.completed, command.completed))
					return rejected("stale-occurrence");
				const matches = sharedControlPanelConditionMatches(
					command.subscription,
					command.signal,
					command.hostNowMs,
				);
				const evidenceKey = joined(
					old.tenantId,
					old.subscriptionId,
					command.subscription.conditionRevision,
					command.signal.evidenceFingerprint,
				);
				const duplicate = draft.alertEvidence.has(evidenceKey);
				const history = [...draft.alerts.values()]
					.filter(
						(x) =>
							x.tenantId === old.tenantId &&
							x.subscriptionId === old.subscriptionId &&
							x.conditionRevision === command.subscription.conditionRevision &&
							command.hostNowMs - x.createdAtMs <
								Math.max(command.subscription.cooldownMs, command.subscription.intervalMs),
					)
					.sort((a, b) => b.createdAtMs - a.createdAtMs);
				const cooldown = history.some(
					(x) => command.hostNowMs - x.createdAtMs < command.subscription.cooldownMs,
				);
				const rateCap = history.length >= command.subscription.rateCap;
				const expectedSuppression = !matches
					? "condition-false"
					: duplicate
						? "duplicate"
						: cooldown
							? "cooldown"
							: rateCap
								? "rate-cap"
								: null;
				if (expectedSuppression === null) {
					if (!command.alert || command.suppression) return rejected("alert-decision-mismatch");
					validateAlert(
						command.alert,
						old,
						command.signal,
						command.hostNowMs,
						command.subscription,
					);
					const alertId = joined(command.alert.tenantId, command.alert.alertId);
					if (draft.alerts.has(alertId))
						return same(draft.alerts.get(alertId), command.alert)
							? accepted("alert-rereferenced", old)
							: rejected("alert-conflict");
					draft.alerts.set(alertId, snapshot(command.alert));
					draft.alertEvidence.set(evidenceKey, command.alert.alertId);
				} else {
					if (
						!command.suppression ||
						command.alert ||
						command.suppression.reason !== expectedSuppression
					)
						return rejected("suppression-decision-mismatch");
					const suppressionId = joined(
						command.suppression.tenantId,
						command.suppression.suppressionId,
					);
					const prior = draft.suppressions.get(suppressionId);
					if (prior && !same(prior, command.suppression)) return rejected("suppression-conflict");
					draft.suppressions.set(suppressionId, snapshot(command.suppression));
				}
				const evaluation = snapshot({
					kind: "shared-control-panel-occurrence-evaluation" as const,
					evidenceFingerprint: command.signal.evidenceFingerprint,
					conditionRevision: command.subscription.conditionRevision,
					policyRevision: command.subscription.policyRevision,
					decisionFingerprint: evaluationDecisionFingerprint(
						command.subscription,
						command.signal,
						command.alert,
						command.suppression,
					),
					alertId: command.alert?.alertId ?? null,
					suppressionId: command.suppression?.suppressionId ?? null,
					evaluatedAtMs: command.hostNowMs,
				});
				const next = snapshot({
					...old,
					evaluation,
					state: "evaluated" as const,
					reason: "evaluated",
				});
				return replaceOccurrence(draft, old, next, command.hostNowMs);
			});
		},
		async createAuthorizedInboxDeliveryAtomically(command) {
			return atomic((draft) => {
				validateDelivery(command.value);
				const auth = authorization(draft, command.truth, command.hostNowMs);
				if (
					!auth.accepted ||
					command.value.recipientId !== command.truth.subjectId ||
					command.value.redactionRevision !== command.truth.currentRedactionRevision
				)
					return rejected("authorization-stale-or-denied");
				const alert = draft.alerts.get(joined(command.value.tenantId, command.value.alertId));
				if (
					!alert ||
					alert.panelId !== command.truth.pins.panelId ||
					alert.panelRevision !== command.truth.pins.panelRevision
				)
					return rejected("alert-missing-or-mismatch");
				const k = joined(command.value.tenantId, command.value.deliveryId);
				const old = draft.deliveries.get(k);
				if (old)
					return same(old, command.value)
						? accepted("delivery-rereferenced", old)
						: rejected("delivery-conflict");
				draft.deliveries.set(k, snapshot(command.value));
				audit(
					draft,
					command.value.tenantId,
					command.value.recipientId,
					command.value.deliveryId,
					"delivery-created",
					command.hostNowMs,
				);
				return accepted("delivery-created", command.value);
			});
		},
		async transitionAuthorizedInboxDeliveryAtomically(command) {
			return atomic((draft) => {
				if (
					!(
						(command.from === "pending" && command.to === "attempted") ||
						(command.from === "attempted" &&
							["delivered", "failed", "suppressed", "expired"].includes(command.to))
					)
				)
					return rejected("invalid-delivery-transition");
				const auth = authorization(draft, command.truth, command.hostNowMs);
				if (!auth.accepted) return rejected("authorization-stale-or-denied");
				const k = joined(command.truth.pins.tenantId, command.deliveryId);
				const old = draft.deliveries.get(k);
				const alert = old
					? draft.alerts.get(joined(command.truth.pins.tenantId, old.alertId))
					: undefined;
				if (
					!old ||
					!alert ||
					alert.tenantId !== command.truth.pins.tenantId ||
					alert.panelId !== command.truth.pins.panelId ||
					alert.panelRevision !== command.truth.pins.panelRevision ||
					old.state !== command.from ||
					old.recipientId !== command.truth.subjectId ||
					old.redactionRevision !== command.truth.currentRedactionRevision
				)
					return rejected("delivery-transition-conflict");
				const terminal = ["delivered", "failed", "suppressed", "expired"].includes(command.to);
				const next = snapshot({
					...old,
					state: command.to,
					deliveredAtMs: command.to === "delivered" ? command.hostNowMs : null,
					terminalAtMs: terminal ? command.hostNowMs : null,
				});
				validateDelivery(next);
				draft.deliveries.set(k, next);
				audit(
					draft,
					old.tenantId,
					old.recipientId,
					old.deliveryId,
					`delivery-${command.to}`,
					command.hostNowMs,
				);
				return accepted(`delivery-${command.to}`, next);
			});
		},
		async readOrderedAudit(command) {
			return atomic((draft) => draft.audits.filter((entry) => entry.tenantId === command.tenantId));
		},
	};
}

function scope(value: SharedControlPanelCanonicalTruth) {
	const {
		runId: _run,
		attempt: _attempt,
		outcomeId: _outcome,
		runHighWater: _runWater,
		evidenceHighWater: _evidenceWater,
		freshnessHighWater: _freshnessWater,
		...pins
	} = value.pins;
	return pins;
}
function subscriptionTruth(value: SharedControlPanelSubscriptionRevision, observedAtMs: number) {
	return {
		kind: "shared-control-panel-current-truth" as const,
		pins: value.pins,
		subjectId: value.subjectId,
		grantId: value.grantId,
		capability: "subscribe" as const,
		capabilityRevision: value.capabilityRevision,
		currentPolicyRevision: value.policyRevision,
		currentRedactionRevision: value.redactionRevision,
		actorSessionRevision: value.actorSessionRevision,
		observedAtMs,
	};
}
function candidateMatchesSubscription(
	candidate: Command<"materializeAuthorizedCandidateAtomically">["candidate"],
	occurrence: SharedControlPanelOccurrence,
	subscription: SharedControlPanelSubscriptionRevision,
) {
	const request = candidate.request;
	const metadata = request.metadata as Record<string, unknown> | undefined;
	const refs = new Set((request.sourceRefs ?? []).map((ref) => `${ref.kind}:${ref.id}`));
	return (
		candidate.occurrenceId === occurrence.occurrenceId &&
		metadata?.executionEnvironmentId === subscription.pins.environmentId &&
		metadata.executionEnvironmentRevision === subscription.pins.environmentRevision &&
		refs.has(`query-revision:${subscription.pins.queryRevision}`) &&
		refs.has(`spec-revision:${subscription.pins.specRevision}`) &&
		refs.has(`input-revision:${subscription.pins.inputRevision}`) &&
		refs.has(`source-revision:${subscription.pins.sourceRevision}`) &&
		refs.has(`schema-revision:${subscription.pins.schemaRevision}`)
	);
}
