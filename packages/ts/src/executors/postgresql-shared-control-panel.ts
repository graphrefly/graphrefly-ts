/** Concrete host-owned PostgreSQL shared control-panel authority (D608). Root intentionally closed. */
import type {
	SourceRef,
	ToolProviderAdapterRunRequested,
	ToolProviderRunAdmission,
} from "../orchestration/index.js";

export const POSTGRESQL_SHARED_CONTROL_PANEL_COMPATIBILITY =
	"postgresql-shared-control-panel-v1" as const;
export const POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA =
	"graphrefly_postgresql_shared_control_panel_v1" as const;

export type SharedControlPanelCapability =
	| "view"
	| "query-rerun"
	| "download"
	| "input"
	| "subscribe"
	| "action";
export type SharedControlPanelCondition = "stale" | "anomaly";
export interface SharedControlPanelHostClock {
	now(): number;
}
export interface SharedControlPanelVerifiedTerminalOutcome {
	readonly runId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly terminalHighWater: number;
	readonly outcomeEvidenceFingerprint: string;
	readonly evidenceRefs: readonly SourceRef[];
}
export interface SharedControlPanelTerminalOutcomeAuthority {
	lookup(value: {
		readonly tenantId: string;
		readonly occurrenceId: string;
		readonly admissionId: string;
		readonly approvedRunId: string;
	}): Promise<SharedControlPanelVerifiedTerminalOutcome | null>;
}
export interface SharedControlPanelSubscriptionBindingAuthority {
	lookup(value: {
		readonly intentId: string;
		readonly idempotencyKey: string;
	}): Promise<SharedControlPanelCanvasSubscriptionBinding | null>;
}

export interface SharedControlPanelPins {
	readonly tenantId: string;
	readonly workspaceId: string;
	readonly workGraphId: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly queryRevision: string;
	readonly specRevision: string;
	readonly sourceRevision: string;
	readonly schemaRevision: string;
	readonly artifactRevision: string;
	readonly inputRevision: string;
	readonly topologyFingerprint: string;
	readonly policyRevision: string;
	readonly redactionRevision: string;
	readonly environmentId: string;
	readonly environmentRevision: string;
	readonly runId: string;
	readonly requestId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly runHighWater: number;
	readonly evidenceHighWater: number;
	readonly freshnessHighWater: number;
}

export interface SharedControlPanelFrame {
	readonly frameId: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}
export interface SharedControlPanelWidget {
	readonly widgetId: string;
	readonly frameId: string;
	readonly bindingKind: "answer" | "topology" | "input" | "status";
	readonly bindingRef: string;
	readonly displayRevision: string;
}

export interface SharedControlPanelRevision {
	readonly kind: "shared-control-panel-revision";
	readonly pins: SharedControlPanelPins;
	readonly previousRevision: string | null;
	readonly title: string;
	readonly frames: readonly SharedControlPanelFrame[];
	readonly widgets: readonly SharedControlPanelWidget[];
	readonly immutableRefs: readonly SourceRef[];
	readonly createdBy: string;
	readonly createdAtMs: number;
}

export interface SharedControlPanelGrant {
	readonly kind: "shared-control-panel-grant";
	readonly grantId: string;
	readonly tenantId: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly subjectId: string;
	readonly capability: SharedControlPanelCapability;
	readonly capabilityRevision: string;
	readonly policyRevision: string;
	readonly redactionRevision: string;
	readonly issuedAtMs: number;
	readonly expiresAtMs: number;
	readonly revokedAtMs: number | null;
	readonly actorSessionRevision: string;
}

export interface SharedControlPanelRestrictedProjection {
	readonly kind: "shared-control-panel-restricted-projection";
	readonly grantId: string;
	readonly tenantId: string;
	readonly workspaceId: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly workGraphId: string;
	readonly subjectId: string;
	readonly capability: SharedControlPanelCapability;
	readonly policyRevision: string;
	readonly redactionRevision: string;
	readonly frameIds: readonly string[];
	readonly widgetIds: readonly string[];
}

export interface SharedControlPanelSubscriptionRevision {
	readonly kind: "shared-control-panel-subscription-revision";
	readonly tenantId: string;
	readonly subscriptionId: string;
	readonly subscriptionRevision: string;
	readonly previousRevision: string | null;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly subjectId: string;
	readonly pins: SharedControlPanelPins;
	readonly grantId: string;
	readonly capabilityRevision: string;
	readonly actorSessionRevision: string;
	readonly intervalMs: number;
	readonly scheduleAnchorMs: number;
	readonly expiresAtMs: number;
	readonly condition: SharedControlPanelCondition;
	readonly conditionRevision: string;
	readonly staleAfterMs: number;
	readonly anomalyThreshold: number;
	readonly cooldownMs: number;
	readonly rateCap: number;
	readonly policyRevision: string;
	readonly redactionRevision: string;
	readonly active: boolean;
	readonly effectiveAtMs: number;
}
export interface SharedControlPanelCanvasCoordinate {
	readonly id: string;
	readonly revision: string;
}
export interface SharedControlPanelCanvasSubscriptionBinding {
	readonly capability: "subscribe";
	readonly tenant: SharedControlPanelCanvasCoordinate;
	readonly workspace: SharedControlPanelCanvasCoordinate;
	readonly workGraph: SharedControlPanelCanvasCoordinate;
	readonly panel: SharedControlPanelCanvasCoordinate;
	readonly panelHead: SharedControlPanelCanvasCoordinate;
	readonly panelRevision: SharedControlPanelCanvasCoordinate;
	readonly sourceRequest: SharedControlPanelCanvasCoordinate;
	readonly sourceRun: SharedControlPanelCanvasCoordinate;
	readonly sourceOutcome: SharedControlPanelCanvasCoordinate;
	readonly queryPlan: SharedControlPanelCanvasCoordinate;
	readonly spec: SharedControlPanelCanvasCoordinate;
	readonly input: SharedControlPanelCanvasCoordinate;
	readonly source: SharedControlPanelCanvasCoordinate;
	readonly schema: SharedControlPanelCanvasCoordinate;
	readonly evidence: SharedControlPanelCanvasCoordinate;
	readonly artifact: SharedControlPanelCanvasCoordinate;
	readonly actorSession: SharedControlPanelCanvasCoordinate;
	readonly actorSubject: SharedControlPanelCanvasCoordinate;
	readonly actorGrant: SharedControlPanelCanvasCoordinate;
	readonly actorCapabilitySet: SharedControlPanelCanvasCoordinate;
	readonly capabilityRevision: SharedControlPanelCanvasCoordinate;
	readonly actorAdmission: SharedControlPanelCanvasCoordinate;
	readonly issuedAt: SharedControlPanelCanvasCoordinate;
	readonly expiresAt: SharedControlPanelCanvasCoordinate;
	readonly policy: SharedControlPanelCanvasCoordinate;
	readonly redaction: SharedControlPanelCanvasCoordinate;
	readonly attempt: number;
	readonly topologyFingerprint: string;
	readonly terminalHighWater: string;
	readonly evidenceHighWater: string;
	readonly artifactHighWater: string;
	readonly freshnessHighWater: string;
}
export interface SharedControlPanelCanvasSubscriptionIntent {
	readonly kind: "workspace-shared-control-panel-subscription-intent";
	readonly contractVersion: "1";
	readonly intentId: string;
	readonly idempotencyKey: string;
	readonly action: "create" | "pause" | "resume" | "revoke";
	readonly binding: SharedControlPanelCanvasSubscriptionBinding;
	readonly subscription?: SharedControlPanelCanvasCoordinate;
	readonly intervalSeconds?: number;
	readonly condition?: SharedControlPanelCondition;
}
export interface SharedControlPanelHostSubscriptionRequest {
	readonly kind: "shared-control-panel-host-subscription-request";
	readonly intent: SharedControlPanelCanvasSubscriptionIntent;
	readonly revision: SharedControlPanelSubscriptionRevision;
	readonly admittedAtMs: number;
	readonly bindingAuthorityFingerprint: string;
}

export interface SharedControlPanelCurrentTruth {
	readonly kind: "shared-control-panel-current-truth";
	readonly pins: SharedControlPanelPins;
	readonly subjectId: string;
	readonly grantId: string;
	readonly capability: SharedControlPanelCapability;
	readonly capabilityRevision: string;
	readonly currentPolicyRevision: string;
	readonly currentRedactionRevision: string;
	readonly actorSessionRevision: string;
	readonly observedAtMs: number;
}

export interface SharedControlPanelOccurrence {
	readonly kind: "shared-control-panel-occurrence";
	readonly tenantId: string;
	readonly occurrenceId: string;
	readonly subscriptionId: string;
	readonly subscriptionRevision: string;
	readonly conditionRevision: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly dueAtMs: number;
	readonly claimedAtMs: number;
	readonly admissionFingerprint: string;
	readonly state: "claimed" | "candidate-created" | "completed" | "evaluated";
	readonly reason: string;
	readonly candidate: SharedControlPanelCandidate | null;
	readonly completed: SharedControlPanelCompletedOccurrence | null;
	readonly evaluation: SharedControlPanelOccurrenceEvaluation | null;
}
export interface SharedControlPanelOccurrenceEvaluation {
	readonly kind: "shared-control-panel-occurrence-evaluation";
	readonly evidenceFingerprint: string;
	readonly conditionRevision: string;
	readonly policyRevision: string;
	readonly decisionFingerprint: string;
	readonly alertId: string | null;
	readonly suppressionId: string | null;
	readonly evaluatedAtMs: number;
}

export interface SharedControlPanelSignal {
	readonly observedAtMs: number;
	readonly lastSuccessfulRunAtMs: number;
	readonly value: number;
	readonly baseline: number;
	readonly evidenceFingerprint: string;
	readonly evidenceRefs: readonly SourceRef[];
}

export interface SharedControlPanelCandidate {
	readonly kind: "shared-control-panel-run-candidate";
	readonly occurrenceId: string;
	/** A fresh ordinary M9/M10 request which still requires D419 admission. */
	readonly request: ToolProviderAdapterRunRequested;
	readonly createdAtMs: number;
}

export interface SharedControlPanelCompletedOccurrence {
	readonly kind: "shared-control-panel-completed-occurrence";
	readonly occurrenceId: string;
	readonly candidateRequestId: string;
	readonly candidateRunId: string;
	readonly admissionId: string;
	readonly admissionSourceRefs: readonly SourceRef[];
	/** D419-approved ordinary run identity; intentionally differs from candidateRunId. */
	readonly runId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly terminalHighWater: number;
	readonly outcomeEvidenceFingerprint: string;
	readonly evidenceRefs: readonly SourceRef[];
	readonly completedAtMs: number;
}

export interface SharedControlPanelSuppression {
	readonly kind: "shared-control-panel-suppression";
	readonly suppressionId: string;
	readonly tenantId: string;
	readonly occurrenceId: string;
	readonly subscriptionId: string;
	readonly subscriptionRevision: string;
	readonly conditionRevision: string;
	readonly evidenceFingerprint: string;
	readonly reason: "condition-false" | "cooldown" | "rate-cap" | "duplicate";
	readonly policyRevision: string;
	readonly createdAtMs: number;
}

export interface SharedControlPanelAlert {
	readonly kind: "shared-control-panel-alert";
	readonly alertId: string;
	readonly tenantId: string;
	readonly occurrenceId: string;
	readonly subscriptionId: string;
	readonly subscriptionRevision: string;
	readonly conditionRevision: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly condition: SharedControlPanelCondition;
	readonly evidenceFingerprint: string;
	readonly evidenceRefs: readonly SourceRef[];
	readonly createdAtMs: number;
}

export interface SharedControlPanelInboxDelivery {
	readonly kind: "shared-control-panel-inbox-delivery";
	readonly deliveryId: string;
	readonly tenantId: string;
	readonly alertId: string;
	readonly recipientId: string;
	readonly redactionRevision: string;
	readonly state: "pending" | "attempted" | "delivered" | "failed" | "suppressed" | "expired";
	readonly createdAtMs: number;
	readonly deliveredAtMs: number | null;
	readonly terminalAtMs: number | null;
}

export interface SharedControlPanelAuditEntry {
	readonly kind: "shared-control-panel-audit";
	readonly tenantId: string;
	readonly sequence: number;
	readonly eventId: string;
	readonly eventKind: string;
	readonly subjectId: string;
	readonly objectId: string;
	readonly occurredAtMs: number;
}

export interface SharedControlPanelStoreResult<T = never> {
	readonly accepted: boolean;
	readonly code: string;
	readonly value?: T;
}
export interface SharedControlPanelCanonicalTruth {
	readonly kind: "shared-control-panel-canonical-truth";
	readonly pins: SharedControlPanelPins;
	readonly recordedAtMs: number;
}
export interface SharedControlPanelRecordedAdmission {
	readonly kind: "shared-control-panel-recorded-admission";
	readonly tenantId: string;
	readonly occurrenceId: string;
	readonly admission: ToolProviderRunAdmission;
	readonly bodyFingerprint: string;
	readonly recordedAtMs: number;
}
export interface SharedControlPanelRecordedTerminalOutcome {
	readonly kind: "shared-control-panel-recorded-terminal-outcome";
	readonly tenantId: string;
	readonly occurrenceId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly terminalHighWater: number;
	readonly outcomeEvidenceFingerprint: string;
	readonly evidenceRefs: readonly SourceRef[];
	readonly recordedAtMs: number;
}
export interface SharedControlPanelQueryRerunRequest {
	readonly kind: "shared-control-panel-query-rerun-request";
	readonly rerunId: string;
	readonly idempotencyKey: string;
	readonly truth: SharedControlPanelCurrentTruth;
	readonly candidate: SharedControlPanelCandidate;
	readonly binding: SharedControlPanelQueryRerunBinding;
	readonly requestedAtMs: number;
}
export interface SharedControlPanelQueryRerunBinding {
	readonly tenantId: string;
	readonly workspaceId: string;
	readonly workGraphId: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly priorRequestId: string;
	readonly priorRunId: string;
	readonly priorOutcomeId: string;
	readonly queryRevision: string;
	readonly specRevision: string;
	readonly inputRevision: string;
	readonly sourceRevision: string;
	readonly policyRevision: string;
}

export interface SharedControlPanelSqlResult {
	readonly rowCount: number;
	readonly rows: readonly Readonly<Record<string, unknown>>[];
}
export interface SharedControlPanelSqlClient {
	query(text: string, values?: readonly unknown[]): Promise<SharedControlPanelSqlResult>;
	transaction<T>(run: (client: SharedControlPanelSqlClient) => Promise<T>): Promise<T>;
}

export interface PostgresqlSharedControlPanelStore {
	readonly compatibility: typeof POSTGRESQL_SHARED_CONTROL_PANEL_COMPATIBILITY;
	readonly schema: typeof POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA;
	install(): Promise<void>;
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
		nowMs: number,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelRestrictedProjection>>;
	issueGrant(
		value: SharedControlPanelGrant,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelGrant>>;
	revokeGrant(
		tenantId: string,
		grantId: string,
		revokedAtMs: number,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelGrant>>;
	authorize(
		truth: SharedControlPanelCurrentTruth,
		nowMs: number,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelGrant>>;
	createSubscription(
		request: SharedControlPanelHostSubscriptionRequest,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelSubscriptionRevision>>;
	claimDue(
		subscription: SharedControlPanelSubscriptionRevision,
		occurrenceId: string,
		dueAtMs: number,
		nowMs: number,
		evidenceFingerprint: string,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	materializeCandidate(
		occurrence: SharedControlPanelOccurrence,
		candidate: SharedControlPanelCandidate,
		subscription: SharedControlPanelSubscriptionRevision,
		truth: SharedControlPanelCurrentTruth,
		nowMs: number,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	completeOccurrence(
		occurrence: SharedControlPanelOccurrence,
		completed: SharedControlPanelCompletedOccurrence,
		nowMs: number,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelOccurrence>>;
	evaluateOccurrence(
		occurrence: SharedControlPanelOccurrence,
		completed: SharedControlPanelCompletedOccurrence,
		subscription: SharedControlPanelSubscriptionRevision,
		signal: SharedControlPanelSignal,
		alert: SharedControlPanelAlert | null,
		suppression: SharedControlPanelSuppression | null,
		nowMs: number,
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
		nowMs: number,
	): Promise<SharedControlPanelStoreResult<SharedControlPanelInboxDelivery>>;
	audit(tenantId: string): Promise<readonly SharedControlPanelAuditEntry[]>;
}

const INSTALL_SQL = `CREATE SCHEMA IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA};
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_revisions (tenant_id text NOT NULL, panel_id text NOT NULL, panel_revision text NOT NULL, idempotency_key text NOT NULL, body jsonb NOT NULL, created_at_ms bigint NOT NULL, PRIMARY KEY (tenant_id,panel_id,panel_revision), UNIQUE(tenant_id,panel_id,idempotency_key));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_heads (tenant_id text NOT NULL, panel_id text NOT NULL, panel_revision text NOT NULL, PRIMARY KEY(tenant_id,panel_id));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.canonical_truth (tenant_id text NOT NULL, panel_id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(tenant_id,panel_id));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.grants (tenant_id text NOT NULL, grant_id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(tenant_id,grant_id));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscriptions (tenant_id text NOT NULL, subscription_id text NOT NULL, subscription_revision text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(tenant_id,subscription_id,subscription_revision));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_heads (tenant_id text NOT NULL, subscription_id text NOT NULL, subscription_revision text NOT NULL, PRIMARY KEY(tenant_id,subscription_id));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_requests (tenant_id text NOT NULL, intent_id text NOT NULL, idempotency_key text NOT NULL, subscription_id text NOT NULL, subscription_revision text NOT NULL, action text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(tenant_id,intent_id), UNIQUE(tenant_id,idempotency_key), UNIQUE(tenant_id,subscription_id,subscription_revision));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.occurrences (tenant_id text NOT NULL, occurrence_id text NOT NULL, subscription_id text NOT NULL, subscription_revision text NOT NULL, due_at_ms bigint NOT NULL, body jsonb NOT NULL, PRIMARY KEY(tenant_id,subscription_id,subscription_revision,due_at_ms), UNIQUE(tenant_id,occurrence_id));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.alerts (tenant_id text NOT NULL, alert_id text NOT NULL, subscription_id text NOT NULL, subscription_revision text NOT NULL, condition_revision text NOT NULL, occurrence_id text NOT NULL, evidence_fingerprint text NOT NULL, created_at_ms bigint NOT NULL, body jsonb NOT NULL, PRIMARY KEY(tenant_id,alert_id), UNIQUE(tenant_id,subscription_id,condition_revision,evidence_fingerprint));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.suppressions (tenant_id text NOT NULL, suppression_id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(tenant_id,suppression_id));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.admissions (tenant_id text NOT NULL, occurrence_id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(tenant_id,occurrence_id));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.terminal_outcomes (tenant_id text NOT NULL, occurrence_id text NOT NULL, run_id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(tenant_id,occurrence_id,run_id));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.query_reruns (tenant_id text NOT NULL, rerun_id text NOT NULL, idempotency_key text NOT NULL, body jsonb NOT NULL, state text NOT NULL, PRIMARY KEY(tenant_id,rerun_id), UNIQUE(tenant_id,idempotency_key));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.deliveries (tenant_id text NOT NULL, delivery_id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(tenant_id,delivery_id));
CREATE TABLE IF NOT EXISTS ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.audit (tenant_id text NOT NULL, sequence bigint GENERATED ALWAYS AS IDENTITY, body jsonb NOT NULL, PRIMARY KEY(tenant_id,sequence));`;

export function postgresql16SharedControlPanelStore(
	client: SharedControlPanelSqlClient,
	clock: SharedControlPanelHostClock,
	terminalAuthority: SharedControlPanelTerminalOutcomeAuthority,
	subscriptionBindingAuthority: SharedControlPanelSubscriptionBindingAuthority,
): PostgresqlSharedControlPanelStore {
	if (!client || typeof client.query !== "function" || typeof client.transaction !== "function")
		throw new TypeError("invalid-shared-control-panel-sql-client");
	if (!clock || typeof clock.now !== "function")
		throw new TypeError("invalid-shared-control-panel-clock");
	if (!terminalAuthority || typeof terminalAuthority.lookup !== "function")
		throw new TypeError("invalid-terminal-outcome-authority");
	if (!subscriptionBindingAuthority || typeof subscriptionBindingAuthority.lookup !== "function")
		throw new TypeError("invalid-subscription-binding-authority");
	return {
		compatibility: POSTGRESQL_SHARED_CONTROL_PANEL_COMPATIBILITY,
		schema: POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA,
		async install() {
			await client.query(INSTALL_SQL);
		},
		async recordCanonicalTruth(value) {
			validateCanonicalTruth(value);
			const now = clockNow(clock);
			if (value.recordedAtMs !== now) return rejected("non-host-truth-time");
			return client.transaction(async (tx) => {
				const prior = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.canonical_truth WHERE tenant_id=$1 AND panel_id=$2 FOR UPDATE`,
					[value.pins.tenantId, value.pins.panelId],
				);
				if (prior.rowCount) {
					const old = validateCanonicalTruth(
						prior.rows[0]?.body as SharedControlPanelCanonicalTruth,
					);
					if (canonical(old) === canonical(value))
						return accepted("canonical-truth-rereferenced", old);
					if (
						canonical(truthScope(old.pins)) !== canonical(truthScope(value.pins)) ||
						value.pins.runHighWater < old.pins.runHighWater ||
						value.pins.evidenceHighWater < old.pins.evidenceHighWater ||
						value.pins.freshnessHighWater < old.pins.freshnessHighWater ||
						value.pins.attempt < old.pins.attempt ||
						(value.pins.runHighWater === old.pins.runHighWater &&
							value.pins.evidenceHighWater === old.pins.evidenceHighWater &&
							value.pins.freshnessHighWater === old.pins.freshnessHighWater &&
							value.pins.attempt === old.pins.attempt)
					)
						return rejected("canonical-truth-cas-conflict");
				}
				const r = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.canonical_truth VALUES ($1,$2,$3::jsonb) ON CONFLICT (tenant_id,panel_id) DO UPDATE SET body=EXCLUDED.body`,
					[value.pins.tenantId, value.pins.panelId, json(value)],
				);
				if (r.rowCount !== 1) return rejected("canonical-truth-cas-conflict");
				await writeAudit(
					tx,
					value.pins.tenantId,
					"host",
					value.pins.panelId,
					"canonical-truth-recorded",
					now,
				);
				return accepted("canonical-truth-recorded", snapshot(value));
			});
		},
		async recordAdmission(value) {
			validateRecordedAdmission(value);
			const now = clockNow(clock);
			if (value.recordedAtMs !== now) return rejected("non-host-admission-time");
			return client.transaction(async (tx) => {
				const owner = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.occurrences WHERE tenant_id=$1 AND occurrence_id=$2 FOR UPDATE`,
					[value.tenantId, value.occurrenceId],
				);
				if (!owner.rowCount) return rejected("admission-owner-missing");
				const occurrence = validateOccurrence(owner.rows[0]?.body);
				const candidate = occurrence.candidate?.request;
				if (
					occurrence.tenantId !== value.tenantId ||
					occurrence.state !== "candidate-created" ||
					!candidate ||
					value.admission.runId !== candidate.runId ||
					value.admission.requestId !== candidate.requestId ||
					value.admission.adapterInputId !== candidate.adapterInputId ||
					value.admission.operationId !== candidate.operationId
				)
					return rejected("admission-owner-mismatch");
				const r = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.admissions VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,
					[value.tenantId, value.occurrenceId, json(value)],
				);
				if (r.rowCount === 1) {
					await writeAudit(
						tx,
						value.tenantId,
						"host",
						value.occurrenceId,
						"admission-recorded",
						now,
					);
					return accepted("admission-recorded", snapshot(value));
				}
				const prior = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.admissions WHERE tenant_id=$1 AND occurrence_id=$2 FOR UPDATE`,
					[value.tenantId, value.occurrenceId],
				);
				return sameOrConflict(
					prior.rows[0]?.body,
					value,
					"admission-rereferenced",
					"admission-conflict",
				);
			});
		},
		async recordTerminalOutcome(value) {
			validateRecordedTerminalOutcome(value);
			const now = clockNow(clock);
			if (value.recordedAtMs !== now) return rejected("non-host-outcome-time");
			return client.transaction(async (tx) => {
				const admissionRow = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.admissions WHERE tenant_id=$1 AND occurrence_id=$2 FOR UPDATE`,
					[value.tenantId, value.occurrenceId],
				);
				if (!admissionRow.rowCount) return rejected("recorded-admission-missing");
				const recorded = validateRecordedAdmission(
					admissionRow.rows[0]?.body as SharedControlPanelRecordedAdmission,
				);
				if (recorded.admission.approvedRunId !== value.runId)
					return rejected("terminal-outcome-run-mismatch");
				const owner = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.occurrences WHERE tenant_id=$1 AND occurrence_id=$2 FOR UPDATE`,
					[value.tenantId, value.occurrenceId],
				);
				if (
					!owner.rowCount ||
					validateOccurrence(owner.rows[0]?.body).state !== "candidate-created"
				)
					return rejected("terminal-outcome-owner-mismatch");
				const verified = await terminalAuthority.lookup({
					tenantId: value.tenantId,
					occurrenceId: value.occurrenceId,
					admissionId: recorded.admission.admissionId,
					approvedRunId: recorded.admission.approvedRunId!,
				});
				if (verified === null) return rejected("terminal-outcome-unverified");
				const canonicalOutcome = validateRecordedTerminalOutcome({
					kind: "shared-control-panel-recorded-terminal-outcome",
					tenantId: value.tenantId,
					occurrenceId: value.occurrenceId,
					...verified,
					recordedAtMs: now,
				});
				if (canonical(canonicalOutcome) !== canonical(value))
					return rejected("terminal-outcome-expected-mismatch");
				const inserted = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.terminal_outcomes VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
					[value.tenantId, value.occurrenceId, value.runId, json(canonicalOutcome)],
				);
				if (inserted.rowCount === 1) {
					await writeAudit(
						tx,
						value.tenantId,
						"host",
						value.outcomeId,
						"terminal-outcome-recorded",
						now,
					);
					return accepted("terminal-outcome-recorded", canonicalOutcome);
				}
				const prior = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.terminal_outcomes WHERE tenant_id=$1 AND occurrence_id=$2 AND run_id=$3 FOR UPDATE`,
					[value.tenantId, value.occurrenceId, value.runId],
				);
				if (!prior.rowCount) return rejected("terminal-outcome-conflict");
				return sameOrConflict(
					prior.rows[0]?.body,
					canonicalOutcome,
					"terminal-outcome-rereferenced",
					"terminal-outcome-conflict",
				);
			});
		},
		async recordQueryRerun(value) {
			validateQueryRerun(value);
			const now = clockNow(clock);
			if (value.requestedAtMs !== now) return rejected("non-host-rerun-time");
			return client.transaction(async (tx) => {
				const auth = await storedAuthorization(
					tx,
					value.truth.pins,
					value.truth.grantId,
					value.truth.subjectId,
					"query-rerun",
					value.truth.capabilityRevision,
					value.truth.actorSessionRevision,
					value.truth.currentPolicyRevision,
					value.truth.currentRedactionRevision,
					now,
				);
				if (!auth.accepted) return rejected(auth.code);
				const r = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.query_reruns VALUES ($1,$2,$3,$4::jsonb,'recorded') ON CONFLICT DO NOTHING`,
					[value.truth.pins.tenantId, value.rerunId, value.idempotencyKey, json(value)],
				);
				if (r.rowCount === 1) {
					await writeAudit(
						tx,
						value.truth.pins.tenantId,
						value.truth.subjectId,
						value.rerunId,
						"query-rerun-recorded",
						now,
					);
					return accepted("query-rerun-recorded", snapshot(value));
				}
				const prior = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.query_reruns WHERE tenant_id=$1 AND (rerun_id=$2 OR idempotency_key=$3) FOR UPDATE`,
					[value.truth.pins.tenantId, value.rerunId, value.idempotencyKey],
				);
				if (!prior.rowCount) return rejected("query-rerun-conflict");
				return sameOrConflict(
					prior.rows[0]?.body,
					value,
					"query-rerun-rereferenced",
					"query-rerun-conflict",
				);
			});
		},
		async materializeQueryRerun(value) {
			validateQueryRerun(value);
			return client.transaction(async (tx) => {
				const now = clockNow(clock);
				const row = await tx.query(
					`SELECT body,state FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.query_reruns WHERE tenant_id=$1 AND rerun_id=$2 FOR UPDATE`,
					[value.truth.pins.tenantId, value.rerunId],
				);
				if (!row.rowCount || canonical(row.rows[0]?.body) !== canonical(value))
					return rejected("query-rerun-not-current");
				const auth = await storedAuthorization(
					tx,
					value.truth.pins,
					value.truth.grantId,
					value.truth.subjectId,
					"query-rerun",
					value.truth.capabilityRevision,
					value.truth.actorSessionRevision,
					value.truth.currentPolicyRevision,
					value.truth.currentRedactionRevision,
					now,
				);
				if (!auth.accepted) return rejected(auth.code);
				if (row.rows[0]?.state === "materialized")
					return accepted("query-rerun-rereferenced", snapshot(value.candidate));
				const changed = await tx.query(
					`UPDATE ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.query_reruns SET state='materialized' WHERE tenant_id=$1 AND rerun_id=$2 AND state='recorded'`,
					[value.truth.pins.tenantId, value.rerunId],
				);
				if (changed.rowCount !== 1) return rejected("query-rerun-cas-conflict");
				await writeAudit(
					tx,
					value.truth.pins.tenantId,
					value.truth.subjectId,
					value.rerunId,
					"query-rerun-materialized",
					now,
				);
				return accepted("query-rerun-materialized", snapshot(value.candidate));
			});
		},
		async createRevision(value, key) {
			const revision = validateRevision(value);
			if (revision.createdAtMs !== clockNow(clock)) return rejected("non-host-panel-time");
			identity(key, "idempotencyKey");
			return client.transaction(async (tx) => {
				const prior = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_revisions WHERE tenant_id=$1 AND panel_id=$2 AND idempotency_key=$3 FOR UPDATE`,
					[revision.pins.tenantId, revision.pins.panelId, key],
				);
				if (prior.rowCount)
					return sameOrConflict(
						prior.rows[0]?.body,
						revision,
						"idempotent-panel-revision",
						"idempotency-conflict",
					);
				const head = await tx.query(
					`SELECT panel_revision FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_heads WHERE tenant_id=$1 AND panel_id=$2 FOR UPDATE`,
					[revision.pins.tenantId, revision.pins.panelId],
				);
				const current = head.rows[0]?.panel_revision ?? null;
				if (current !== revision.previousRevision) return rejected("stale-panel-head");
				const advanced = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_heads VALUES ($1,$2,$3) ON CONFLICT (tenant_id,panel_id) DO UPDATE SET panel_revision=EXCLUDED.panel_revision WHERE ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_heads.panel_revision IS NOT DISTINCT FROM $4`,
					[
						revision.pins.tenantId,
						revision.pins.panelId,
						revision.pins.panelRevision,
						revision.previousRevision,
					],
				);
				if (advanced.rowCount !== 1) return rejected("panel-head-cas-conflict");
				const bodyInserted = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_revisions (tenant_id,panel_id,panel_revision,idempotency_key,body,created_at_ms) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
					[
						revision.pins.tenantId,
						revision.pins.panelId,
						revision.pins.panelRevision,
						key,
						json(revision),
						revision.createdAtMs,
					],
				);
				if (bodyInserted.rowCount !== 1) throw new TypeError("panel-revision-insert-failed");
				await writeAudit(
					tx,
					revision.pins.tenantId,
					revision.createdBy,
					revision.pins.panelId,
					"panel-revision-created",
					revision.createdAtMs,
				);
				return accepted("panel-revision-created", revision);
			});
		},
		async reopen(tenantId, workspaceId, panelId, panelRevision) {
			for (const [name, value] of Object.entries({ tenantId, workspaceId, panelId, panelRevision }))
				identity(value, name);
			const row = await client.query(
				`SELECT r.body,ct.body AS truth_body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_revisions r JOIN ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_heads h ON h.tenant_id=r.tenant_id AND h.panel_id=r.panel_id AND h.panel_revision=r.panel_revision JOIN ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.canonical_truth ct ON ct.tenant_id=h.tenant_id AND ct.panel_id=h.panel_id WHERE r.tenant_id=$1 AND r.panel_id=$2 AND r.panel_revision=$3`,
				[tenantId, panelId, panelRevision],
			);
			if (!row.rowCount) return rejected("panel-revision-not-current");
			const revision = validateRevision(row.rows[0]?.body as SharedControlPanelRevision);
			const truth = validateCanonicalTruth(
				row.rows[0]?.truth_body as SharedControlPanelCanonicalTruth,
			);
			if (
				revision.pins.workspaceId !== workspaceId ||
				canonical(revision.pins) !== canonical(truth.pins)
			)
				return rejected("workspace-or-current-truth-mismatch");
			return accepted("panel-reopened", revision);
		},
		async projectRestricted(truth, _callerNow) {
			const now = clockNow(clock);
			validateTruth(truth);
			timestamp(now);
			return client.transaction(async (tx) => {
				const authorization = await storedAuthorization(
					tx,
					truth.pins,
					truth.grantId,
					truth.subjectId,
					truth.capability,
					truth.capabilityRevision,
					truth.actorSessionRevision,
					truth.currentPolicyRevision,
					truth.currentRedactionRevision,
					now,
				);
				if (!authorization.accepted) return rejected(authorization.code);
				const row = await tx.query(
					`SELECT r.body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_revisions r JOIN ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_heads h ON h.tenant_id=r.tenant_id AND h.panel_id=r.panel_id AND h.panel_revision=r.panel_revision WHERE r.tenant_id=$1 AND r.panel_id=$2 AND r.panel_revision=$3 FOR UPDATE`,
					[truth.pins.tenantId, truth.pins.panelId, truth.pins.panelRevision],
				);
				if (!row.rowCount) return rejected("panel-revision-not-current");
				const revision = validateRevision(row.rows[0]?.body as SharedControlPanelRevision);
				if (canonical(revision.pins) !== canonical(truth.pins)) return rejected("panel-pins-stale");
				await writeAudit(
					tx,
					truth.pins.tenantId,
					truth.subjectId,
					truth.grantId,
					`capability-admitted:${truth.capability}`,
					now,
				);
				return accepted(
					"restricted-projection",
					snapshot({
						kind: "shared-control-panel-restricted-projection",
						grantId: truth.grantId,
						tenantId: truth.pins.tenantId,
						workspaceId: truth.pins.workspaceId,
						panelId: truth.pins.panelId,
						panelRevision: truth.pins.panelRevision,
						workGraphId: truth.pins.workGraphId,
						subjectId: truth.subjectId,
						capability: truth.capability,
						policyRevision: truth.currentPolicyRevision,
						redactionRevision: truth.currentRedactionRevision,
						frameIds: revision.frames.map((frame) => frame.frameId),
						widgetIds: revision.widgets.map((widget) => widget.widgetId),
					}),
				);
			});
		},
		async issueGrant(value) {
			const grant = validateGrant(value);
			if (grant.issuedAtMs !== clockNow(clock)) return rejected("non-host-grant-time");
			if (!supported(grant.capability)) return rejected("capability-unsupported-v1");
			return client.transaction(async (tx) => {
				const panel = await currentPanel(tx, grant.tenantId, grant.panelId);
				if (panel !== grant.panelRevision) return rejected("stale-panel-revision");
				const result = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.grants VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,
					[grant.tenantId, grant.grantId, json(grant)],
				);
				if (result.rowCount !== 1) return rejected("grant-conflict");
				await writeAudit(
					tx,
					grant.tenantId,
					grant.subjectId,
					grant.grantId,
					"grant-issued",
					grant.issuedAtMs,
				);
				return accepted("grant-issued", grant);
			});
		},
		async revokeGrant(tenantId, grantId, _callerNow) {
			const now = clockNow(clock);
			identity(tenantId, "tenantId");
			identity(grantId, "grantId");
			timestamp(now);
			return client.transaction(async (tx) => {
				const row = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.grants WHERE tenant_id=$1 AND grant_id=$2 FOR UPDATE`,
					[tenantId, grantId],
				);
				if (!row.rowCount) return rejected("grant-missing");
				const grant = validateGrant(row.rows[0]?.body);
				if (grant.revokedAtMs !== null) return accepted("grant-already-revoked", grant);
				const revoked = snapshot({ ...grant, revokedAtMs: now });
				await tx.query(
					`UPDATE ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.grants SET body=$3::jsonb WHERE tenant_id=$1 AND grant_id=$2`,
					[tenantId, grantId, json(revoked)],
				);
				await writeAudit(tx, grant.tenantId, grant.subjectId, grantId, "grant-revoked", now);
				return accepted("grant-revoked", revoked);
			});
		},
		async authorize(truth, _callerNow) {
			const now = clockNow(clock);
			validateTruth(truth);
			if (!supported(truth.capability)) return rejected("capability-unsupported-v1");
			return client.transaction(async (tx) => {
				const result = await storedAuthorization(
					tx,
					truth.pins,
					truth.grantId,
					truth.subjectId,
					truth.capability,
					truth.capabilityRevision,
					truth.actorSessionRevision,
					truth.currentPolicyRevision,
					truth.currentRedactionRevision,
					now,
				);
				if (!result.accepted) return result;
				await writeAudit(
					tx,
					truth.pins.tenantId,
					truth.subjectId,
					truth.grantId,
					`capability-admitted:${truth.capability}`,
					now,
				);
				return result;
			});
		},
		async createSubscription(value) {
			const request = validateHostSubscriptionRequest(value);
			const sub = request.revision;
			if (sub.effectiveAtMs !== clockNow(clock)) return rejected("non-host-subscription-time");
			const authorityLookupResult = await subscriptionBindingAuthority.lookup({
				intentId: request.intent.intentId,
				idempotencyKey: request.intent.idempotencyKey,
			});
			if (authorityLookupResult === null) return rejected("subscription-binding-unverified");
			let authoritativeBinding: SharedControlPanelCanvasSubscriptionBinding;
			try {
				authoritativeBinding = validateCanvasSubscriptionBinding(authorityLookupResult, sub);
			} catch {
				return rejected("subscription-binding-unverified");
			}
			if (
				canonical(authoritativeBinding) !== canonical(request.intent.binding) ||
				boundedFingerprint(authoritativeBinding) !== request.bindingAuthorityFingerprint
			)
				return rejected("subscription-binding-unverified");
			return client.transaction(async (tx) => {
				const priorRequest = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_requests WHERE tenant_id=$1 AND (intent_id=$2 OR idempotency_key=$3) FOR UPDATE`,
					[sub.tenantId, request.intent.intentId, request.intent.idempotencyKey],
				);
				if (priorRequest.rowCount) {
					const prior = validateHostSubscriptionRequest(
						priorRequest.rows[0]?.body as SharedControlPanelHostSubscriptionRequest,
					);
					if (canonical(prior) !== canonical(request))
						return rejected("subscription-request-conflict");
					const current = await tx.query(
						`SELECT s.body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_heads h JOIN ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscriptions s ON s.tenant_id=h.tenant_id AND s.subscription_id=h.subscription_id AND s.subscription_revision=h.subscription_revision WHERE h.tenant_id=$1 AND h.subscription_id=$2 AND h.subscription_revision=$3 FOR UPDATE`,
						[sub.tenantId, sub.subscriptionId, sub.subscriptionRevision],
					);
					if (!current.rowCount) return rejected("stale-subscription-rereference");
					return canonical(
						validateSubscription(current.rows[0]?.body as SharedControlPanelSubscriptionRevision),
					) === canonical(sub)
						? accepted("subscription-request-rereferenced", prior.revision)
						: rejected("subscription-body-conflict");
				}
				const auth = await storedAuthorization(
					tx,
					sub.pins,
					sub.grantId,
					sub.subjectId,
					"subscribe",
					sub.capabilityRevision,
					sub.actorSessionRevision,
					sub.policyRevision,
					sub.redactionRevision,
					sub.effectiveAtMs,
				);
				if (!auth.accepted) return rejected(auth.code);
				const panel = await currentPanel(tx, sub.tenantId, sub.panelId);
				if (panel !== sub.panelRevision) return rejected("stale-panel-revision");
				const head = await tx.query(
					`SELECT subscription_revision FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_heads WHERE tenant_id=$1 AND subscription_id=$2 FOR UPDATE`,
					[sub.tenantId, sub.subscriptionId],
				);
				if ((head.rows[0]?.subscription_revision ?? null) !== sub.previousRevision)
					return rejected("stale-subscription-head");
				if (request.intent.action !== "create") {
					const current = await tx.query(
						`SELECT s.body,r.action FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscriptions s JOIN ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_requests r ON r.tenant_id=s.tenant_id AND r.subscription_id=s.subscription_id AND r.subscription_revision=s.subscription_revision WHERE s.tenant_id=$1 AND s.subscription_id=$2 AND s.subscription_revision=$3 FOR UPDATE`,
						[sub.tenantId, sub.subscriptionId, sub.previousRevision],
					);
					if (!current.rowCount) return rejected("current-subscription-missing");
					const previous = validateSubscription(
						current.rows[0]?.body as SharedControlPanelSubscriptionRevision,
					);
					if (current.rows[0]?.action === "revoke") return rejected("subscription-revoked");
					if (
						(request.intent.action === "pause" && !previous.active) ||
						(request.intent.action === "resume" && previous.active)
					)
						return rejected("invalid-subscription-transition");
				}
				const admitted = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_requests VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING`,
					[
						sub.tenantId,
						request.intent.intentId,
						request.intent.idempotencyKey,
						sub.subscriptionId,
						sub.subscriptionRevision,
						request.intent.action,
						json(request),
					],
				);
				if (admitted.rowCount !== 1) return rejected("subscription-request-cas-conflict");
				const advanced = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_heads VALUES ($1,$2,$3) ON CONFLICT (tenant_id,subscription_id) DO UPDATE SET subscription_revision=EXCLUDED.subscription_revision WHERE ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_heads.subscription_revision IS NOT DISTINCT FROM $4`,
					[sub.tenantId, sub.subscriptionId, sub.subscriptionRevision, sub.previousRevision],
				);
				if (advanced.rowCount !== 1) return rejected("subscription-head-cas-conflict");
				const bodyInserted = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscriptions VALUES ($1,$2,$3,$4::jsonb)`,
					[sub.tenantId, sub.subscriptionId, sub.subscriptionRevision, json(sub)],
				);
				if (bodyInserted.rowCount !== 1) throw new TypeError("subscription-revision-insert-failed");
				await writeAudit(
					tx,
					sub.tenantId,
					sub.subjectId,
					sub.subscriptionId,
					"subscription-revised",
					sub.effectiveAtMs,
				);
				return accepted("subscription-revised", sub);
			});
		},
		async claimDue(sub, occurrenceId, dueAt, _callerNow, fingerprint) {
			const now = clockNow(clock);
			validateSubscription(sub);
			identity(occurrenceId, "occurrenceId");
			identity(fingerprint, "evidenceFingerprint");
			timestamp(dueAt);
			timestamp(now);
			if (
				!sub.active ||
				now < dueAt ||
				dueAt < Math.max(sub.effectiveAtMs, sub.scheduleAnchorMs) ||
				(dueAt - sub.scheduleAnchorMs) % sub.intervalMs !== 0
			)
				return rejected("occurrence-not-due");
			return client.transaction(async (tx) => {
				const head = await tx.query(
					`SELECT h.subscription_revision,s.body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_heads h JOIN ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscriptions s ON s.tenant_id=h.tenant_id AND s.subscription_id=h.subscription_id AND s.subscription_revision=h.subscription_revision WHERE h.tenant_id=$1 AND h.subscription_id=$2 FOR UPDATE`,
					[sub.tenantId, sub.subscriptionId],
				);
				if (
					head.rows[0]?.subscription_revision !== sub.subscriptionRevision ||
					canonical(
						validateSubscription(head.rows[0]?.body as SharedControlPanelSubscriptionRevision),
					) !== canonical(sub)
				)
					return rejected("stale-subscription-revision");
				const auth = await storedAuthorization(
					tx,
					sub.pins,
					sub.grantId,
					sub.subjectId,
					"subscribe",
					sub.capabilityRevision,
					sub.actorSessionRevision,
					sub.policyRevision,
					sub.redactionRevision,
					now,
				);
				if (!auth.accepted) return rejected(auth.code);
				if (now >= sub.expiresAtMs) return rejected("subscription-expired");
				const occurrence: SharedControlPanelOccurrence = snapshot({
					kind: "shared-control-panel-occurrence",
					tenantId: sub.tenantId,
					occurrenceId,
					subscriptionId: sub.subscriptionId,
					subscriptionRevision: sub.subscriptionRevision,
					conditionRevision: sub.conditionRevision,
					panelId: sub.panelId,
					panelRevision: sub.panelRevision,
					dueAtMs: dueAt,
					claimedAtMs: now,
					admissionFingerprint: fingerprint,
					state: "claimed",
					reason: "host-clock-due",
					candidate: null,
					completed: null,
					evaluation: null,
				});
				const inserted = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.occurrences VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING`,
					[
						sub.tenantId,
						occurrenceId,
						sub.subscriptionId,
						sub.subscriptionRevision,
						dueAt,
						json(occurrence),
					],
				);
				if (inserted.rowCount !== 1) {
					const prior = await tx.query(
						`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.occurrences WHERE tenant_id=$1 AND (occurrence_id=$2 OR (subscription_id=$3 AND subscription_revision=$4 AND due_at_ms=$5)) FOR UPDATE`,
						[sub.tenantId, occurrenceId, sub.subscriptionId, sub.subscriptionRevision, dueAt],
					);
					if (!prior.rowCount) return rejected("occurrence-conflict");
					return sameOrConflict(
						prior.rows[0]?.body,
						occurrence,
						"occurrence-rereferenced",
						"occurrence-conflict",
					);
				}
				await writeAudit(tx, sub.tenantId, sub.subjectId, occurrenceId, "occurrence-claimed", now);
				return accepted("occurrence-claimed", occurrence);
			});
		},
		async materializeCandidate(occurrence, candidate, sub, truth, _callerNow) {
			const now = clockNow(clock);
			validateOccurrence(occurrence);
			validateCandidate(candidate, occurrence, now);
			validateSubscription(sub);
			validateTruth(truth);
			if (
				truth.capability !== "subscribe" ||
				canonical(truth.pins) !== canonical(sub.pins) ||
				sub.subscriptionRevision !== occurrence.subscriptionRevision ||
				truth.grantId !== sub.grantId
			)
				return rejected("materialization-pins-mismatch");
			return client.transaction(async (tx) => {
				const current = await currentSubscription(tx, sub);
				if (!current.accepted) return rejected(current.code);
				if (now >= sub.expiresAtMs) return rejected("subscription-expired");
				const auth = await storedAuthorization(
					tx,
					sub.pins,
					sub.grantId,
					sub.subjectId,
					"subscribe",
					sub.capabilityRevision,
					sub.actorSessionRevision,
					sub.policyRevision,
					sub.redactionRevision,
					now,
				);
				if (!auth.accepted) return rejected(auth.code);
				const locked = await lockOccurrence(tx, occurrence);
				if (!locked.accepted) return locked;
				return updateOccurrence(tx, occurrence, "candidate-created", "fresh-d419-candidate", now, {
					candidate: snapshot(candidate),
				});
			});
		},
		async completeOccurrence(occurrence, completed, _callerNow) {
			const now = clockNow(clock);
			validateOccurrence(occurrence);
			validateCompleted(completed, occurrence, now);
			if (!sharedControlPanelCompletedOccurrenceCorrelates(occurrence, completed))
				return rejected("candidate-not-persisted");
			return client.transaction(async (tx) => {
				const admissionRow = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.admissions WHERE tenant_id=$1 AND occurrence_id=$2 FOR UPDATE`,
					[occurrence.tenantId, occurrence.occurrenceId],
				);
				if (!admissionRow.rowCount) return rejected("recorded-admission-missing");
				const recorded = validateRecordedAdmission(
					admissionRow.rows[0]?.body as SharedControlPanelRecordedAdmission,
				);
				const admission = recorded.admission;
				const candidate = occurrence.candidate?.request;
				if (
					recorded.tenantId !== occurrence.tenantId ||
					recorded.occurrenceId !== occurrence.occurrenceId ||
					admission.admissionId !== completed.admissionId ||
					admission.requestId !== completed.candidateRequestId ||
					admission.runId !== completed.candidateRunId ||
					admission.approvedRunId !== completed.runId ||
					!candidate ||
					admission.adapterInputId !== candidate.adapterInputId ||
					admission.operationId !== candidate.operationId
				)
					return rejected("recorded-admission-mismatch");
				const outcomeRow = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.terminal_outcomes WHERE tenant_id=$1 AND occurrence_id=$2 AND run_id=$3 FOR UPDATE`,
					[occurrence.tenantId, occurrence.occurrenceId, completed.runId],
				);
				if (!outcomeRow.rowCount) return rejected("recorded-terminal-outcome-missing");
				const outcome = validateRecordedTerminalOutcome(
					outcomeRow.rows[0]?.body as SharedControlPanelRecordedTerminalOutcome,
				);
				if (!sharedControlPanelRecordedOutcomeMatchesCompleted(outcome, completed))
					return rejected("recorded-terminal-outcome-mismatch");
				const locked = await lockOccurrence(tx, occurrence);
				if (!locked.accepted) return locked;
				return updateOccurrence(tx, occurrence, "completed", "ordinary-run-completed", now, {
					completed: snapshot(completed),
				});
			});
		},
		async evaluateOccurrence(occurrence, completed, sub, signal, alert, suppression, _callerNow) {
			const now = clockNow(clock);
			validateOccurrence(occurrence);
			validateCompleted(completed, occurrence, completed.completedAtMs);
			validateSubscription(sub);
			validateSignal(signal);
			timestamp(now);
			if (
				!["completed", "evaluated"].includes(occurrence.state) ||
				occurrence.completed?.outcomeEvidenceFingerprint !== signal.evidenceFingerprint ||
				canonical(occurrence.completed) !== canonical(completed) ||
				sub.subscriptionRevision !== occurrence.subscriptionRevision ||
				signal.observedAtMs < completed.completedAtMs ||
				canonical(signal.evidenceRefs) !== canonical(completed.evidenceRefs)
			)
				return rejected("evaluation-correlation-mismatch");
			if (occurrence.state === "evaluated") {
				const evaluation = occurrence.evaluation;
				const decisionFingerprint = evaluationDecisionFingerprint(sub, signal, alert, suppression);
				if (
					!evaluation ||
					evaluation.evidenceFingerprint !== signal.evidenceFingerprint ||
					evaluation.conditionRevision !== sub.conditionRevision ||
					evaluation.policyRevision !== sub.policyRevision ||
					evaluation.decisionFingerprint !== decisionFingerprint ||
					evaluation.alertId !== (alert?.alertId ?? null) ||
					evaluation.suppressionId !== (suppression?.suppressionId ?? null)
				)
					return rejected("evaluation-rereference-conflict");
				return client.transaction(async (tx) => {
					const locked = await lockOccurrence(tx, occurrence);
					return locked.accepted ? accepted("evaluation-rereferenced", occurrence) : locked;
				});
			}
			const matches = sharedControlPanelConditionMatches(sub, signal, now);
			return client.transaction(async (tx) => {
				const current = await currentSubscription(tx, sub);
				if (!current.accepted) return rejected(current.code);
				if (now >= sub.expiresAtMs) return rejected("subscription-expired");
				const auth = await storedAuthorization(
					tx,
					sub.pins,
					sub.grantId,
					sub.subjectId,
					"subscribe",
					sub.capabilityRevision,
					sub.actorSessionRevision,
					sub.policyRevision,
					sub.redactionRevision,
					now,
				);
				if (!auth.accepted) return rejected(auth.code);
				const locked = await lockOccurrence(tx, occurrence);
				if (!locked.accepted) return locked;
				const history = await tx.query(
					`SELECT body,created_at_ms FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.alerts WHERE tenant_id=$1 AND subscription_id=$2 AND condition_revision=$3 AND created_at_ms>$4 ORDER BY created_at_ms DESC FOR UPDATE`,
					[
						sub.tenantId,
						sub.subscriptionId,
						sub.conditionRevision,
						Math.max(0, now - Math.max(sub.cooldownMs, sub.intervalMs)),
					],
				);
				const cooldown = history.rows.some(
					(row) => now - safeSqlInteger(row.created_at_ms, "created_at_ms") < sub.cooldownMs,
				);
				const duplicate = history.rows.some((row) => {
					plain(row.body);
					return row.body.evidenceFingerprint === signal.evidenceFingerprint;
				});
				const capped = history.rowCount >= sub.rateCap;
				const required: SharedControlPanelSuppression["reason"] | null = !matches
					? "condition-false"
					: duplicate
						? "duplicate"
						: cooldown
							? "cooldown"
							: capped
								? "rate-cap"
								: null;
				if (
					(alert === null) === (suppression === null) ||
					(required === null && alert === null) ||
					(required !== null && suppression?.reason !== required)
				)
					return rejected("invalid-evaluation-outcome");
				if (alert) {
					validateAlert(alert, occurrence, signal, now, sub);
					const r = await tx.query(
						`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.alerts VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING`,
						[
							alert.tenantId,
							alert.alertId,
							alert.subscriptionId,
							alert.subscriptionRevision,
							alert.conditionRevision,
							alert.occurrenceId,
							alert.evidenceFingerprint,
							alert.createdAtMs,
							json(alert),
						],
					);
					if (r.rowCount !== 1) {
						const prior = await tx.query(
							`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.alerts WHERE tenant_id=$1 AND subscription_id=$2 AND condition_revision=$3 AND evidence_fingerprint=$4`,
							[
								alert.tenantId,
								alert.subscriptionId,
								alert.conditionRevision,
								alert.evidenceFingerprint,
							],
						);
						const reref = sameOrConflict(
							prior.rows[0]?.body,
							alert,
							"alert-rereferenced",
							"alert-dedupe-conflict",
						);
						if (!reref.accepted) return rejected(reref.code);
					}
				} else {
					validateSuppression(
						suppression as SharedControlPanelSuppression,
						occurrence,
						signal,
						sub,
						now,
					);
					const suppressionInsert = await tx.query(
						`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.suppressions VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,
						[
							occurrence.tenantId,
							(suppression as SharedControlPanelSuppression).suppressionId,
							json(suppression),
						],
					);
					if (suppressionInsert.rowCount !== 1) {
						const prior = await tx.query(
							`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.suppressions WHERE tenant_id=$1 AND suppression_id=$2 FOR UPDATE`,
							[occurrence.tenantId, (suppression as SharedControlPanelSuppression).suppressionId],
						);
						if (!prior.rowCount) return rejected("suppression-conflict");
						const reref = sameOrConflict(
							prior.rows[0]?.body,
							suppression,
							"suppression-rereferenced",
							"suppression-conflict",
						);
						if (!reref.accepted) return rejected(reref.code);
					}
				}
				return updateOccurrence(
					tx,
					occurrence,
					"evaluated",
					alert ? "alert-created" : (suppression as SharedControlPanelSuppression).reason,
					now,
					{
						evaluation: snapshot({
							kind: "shared-control-panel-occurrence-evaluation",
							evidenceFingerprint: signal.evidenceFingerprint,
							conditionRevision: sub.conditionRevision,
							policyRevision: sub.policyRevision,
							decisionFingerprint: evaluationDecisionFingerprint(sub, signal, alert, suppression),
							alertId: alert?.alertId ?? null,
							suppressionId: suppression?.suppressionId ?? null,
							evaluatedAtMs: now,
						}),
					},
				);
			});
		},
		async createDelivery(value, truth) {
			const delivery = validateDelivery(value);
			if (delivery.createdAtMs !== clockNow(clock)) return rejected("non-host-delivery-time");
			validateTruth(truth);
			if (delivery.tenantId !== truth.pins.tenantId || delivery.recipientId !== truth.subjectId)
				return rejected("delivery-audience-mismatch");
			if (delivery.state !== "pending") return rejected("delivery-must-start-pending");
			return client.transaction(async (tx) => {
				const auth = await storedAuthorization(
					tx,
					truth.pins,
					truth.grantId,
					delivery.recipientId,
					"view",
					truth.capabilityRevision,
					truth.actorSessionRevision,
					truth.currentPolicyRevision,
					delivery.redactionRevision,
					delivery.createdAtMs,
				);
				if (!auth.accepted) return rejected(auth.code);
				const alert = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.alerts WHERE tenant_id=$1 AND alert_id=$2 FOR UPDATE`,
					[delivery.tenantId, delivery.alertId],
				);
				if (!alert.rowCount) return rejected("alert-missing");
				validateAlertStored(alert.rows[0]?.body, delivery, truth);
				const r = await tx.query(
					`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.deliveries VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,
					[delivery.tenantId, delivery.deliveryId, json(delivery)],
				);
				if (r.rowCount !== 1) return rejected("delivery-conflict");
				await writeAudit(
					tx,
					delivery.tenantId,
					delivery.recipientId,
					delivery.deliveryId,
					"delivery-created",
					delivery.createdAtMs,
				);
				return accepted("delivery-created", delivery);
			});
		},
		async transitionDelivery(id, from, to, truth, _callerNow) {
			const now = clockNow(clock);
			identity(id, "deliveryId");
			validateTruth(truth);
			if (truth.capability !== "view") return rejected("delivery-view-capability-required");
			timestamp(now);
			if (
				!(
					(from === "pending" && to === "attempted") ||
					(from === "attempted" && ["delivered", "failed", "suppressed", "expired"].includes(to))
				)
			)
				return rejected("invalid-delivery-transition");
			return client.transaction(async (tx) => {
				const auth = await storedAuthorization(
					tx,
					truth.pins,
					truth.grantId,
					truth.subjectId,
					"view",
					truth.capabilityRevision,
					truth.actorSessionRevision,
					truth.currentPolicyRevision,
					truth.currentRedactionRevision,
					now,
				);
				if (!auth.accepted) return rejected(auth.code);
				const row = await tx.query(
					`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.deliveries WHERE tenant_id=$1 AND delivery_id=$2 FOR UPDATE`,
					[truth.pins.tenantId, id],
				);
				if (!row.rowCount) return rejected("delivery-missing");
				const current = validateDelivery(row.rows[0]?.body);
				if (current.recipientId !== truth.subjectId || current.tenantId !== truth.pins.tenantId)
					return rejected("delivery-audience-mismatch");
				if (current.state !== from) return rejected("stale-delivery-state");
				const next = snapshot({
					...current,
					state: to,
					deliveredAtMs: to === "delivered" ? now : current.deliveredAtMs,
					terminalAtMs: ["delivered", "failed", "suppressed", "expired"].includes(to) ? now : null,
				}) as SharedControlPanelInboxDelivery;
				await tx.query(
					`UPDATE ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.deliveries SET body=$3::jsonb WHERE tenant_id=$1 AND delivery_id=$2`,
					[current.tenantId, id, json(next)],
				);
				await writeAudit(tx, current.tenantId, current.recipientId, id, `delivery-${to}`, now);
				return accepted(`delivery-${to}`, next);
			});
		},
		async audit(tenantId) {
			identity(tenantId, "tenantId");
			const r = await client.query(
				`SELECT body,sequence FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.audit WHERE tenant_id=$1 ORDER BY sequence ASC`,
				[tenantId],
			);
			return snapshot(
				r.rows.map((row) =>
					validateAudit({
						...object(row.body),
						sequence: safeSqlInteger(row.sequence, "sequence"),
					}),
				),
			);
		},
	};
}

export function sharedControlPanelConditionMatches(
	sub: SharedControlPanelSubscriptionRevision,
	signal: SharedControlPanelSignal,
	nowMs: number,
): boolean {
	validateSubscription(sub);
	validateSignal(signal);
	timestamp(nowMs);
	return sub.condition === "stale"
		? nowMs - signal.lastSuccessfulRunAtMs >= sub.staleAfterMs
		: Math.abs(signal.value - signal.baseline) >= sub.anomalyThreshold;
}
export function sharedControlPanelCapabilitySupported(
	capability: SharedControlPanelCapability,
): boolean {
	return supported(capability);
}
export function sharedControlPanelCompletedOccurrenceCorrelates(
	occurrence: SharedControlPanelOccurrence,
	completed: SharedControlPanelCompletedOccurrence,
): boolean {
	validateOccurrence(occurrence);
	validateCompleted(completed, occurrence, completed.completedAtMs);
	const candidate = occurrence.candidate?.request;
	return (
		candidate !== undefined &&
		candidate.requestId === completed.candidateRequestId &&
		candidate.runId === completed.candidateRunId &&
		candidate.attempt === completed.attempt &&
		completed.admissionSourceRefs.some(
			(ref) => ref.kind === "tool-provider-run-admission" && ref.id === completed.admissionId,
		)
	);
}
export function sharedControlPanelAdmissionFingerprint(
	admission: ToolProviderRunAdmission,
): string {
	validateAdmission(admission);
	return boundedFingerprint(admission);
}
export function sharedControlPanelAdmitCanvasSubscriptionIntent(
	intent: SharedControlPanelCanvasSubscriptionIntent,
	revision: SharedControlPanelSubscriptionRevision,
	admittedAtMs: number,
	authoritativeBinding: SharedControlPanelCanvasSubscriptionBinding,
): SharedControlPanelHostSubscriptionRequest {
	validateCanvasSubscriptionIntentEnvelope(intent);
	const safeIntentBinding = validateCanvasSubscriptionBinding(intent.binding, revision);
	const safeAuthoritativeBinding = validateCanvasSubscriptionBinding(
		authoritativeBinding,
		revision,
	);
	if (canonical(safeIntentBinding) !== canonical(safeAuthoritativeBinding))
		throw new TypeError("canvas-subscription-binding-authority-mismatch");
	return validateHostSubscriptionRequest({
		kind: "shared-control-panel-host-subscription-request",
		intent,
		revision,
		admittedAtMs,
		bindingAuthorityFingerprint: boundedFingerprint(safeAuthoritativeBinding),
	});
}
function boundedFingerprint(value: unknown) {
	let hash = 0xcbf29ce484222325n;
	for (const byte of new TextEncoder().encode(canonical(value))) {
		hash ^= BigInt(byte);
		hash = BigInt.asUintN(64, hash * 0x100000001b3n);
	}
	return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
function evaluationDecisionFingerprint(
	sub: SharedControlPanelSubscriptionRevision,
	signal: SharedControlPanelSignal,
	alert: SharedControlPanelAlert | null,
	suppression: SharedControlPanelSuppression | null,
) {
	return boundedFingerprint({
		condition: sub.condition,
		conditionRevision: sub.conditionRevision,
		policyRevision: sub.policyRevision,
		staleAfterMs: sub.staleAfterMs,
		anomalyThreshold: sub.anomalyThreshold,
		cooldownMs: sub.cooldownMs,
		rateCap: sub.rateCap,
		signal,
		decision: alert
			? { kind: "alert", id: alert.alertId }
			: { kind: "suppression", id: suppression?.suppressionId, reason: suppression?.reason },
	});
}
export function sharedControlPanelRecordedOutcomeMatchesCompleted(
	outcome: SharedControlPanelRecordedTerminalOutcome,
	completed: SharedControlPanelCompletedOccurrence,
): boolean {
	validateRecordedTerminalOutcome(outcome);
	return (
		outcome.runId === completed.runId &&
		outcome.attempt === completed.attempt &&
		outcome.outcomeId === completed.outcomeId &&
		outcome.terminalHighWater === completed.terminalHighWater &&
		outcome.outcomeEvidenceFingerprint === completed.outcomeEvidenceFingerprint &&
		canonical(outcome.evidenceRefs) === canonical(completed.evidenceRefs)
	);
}

function supported(value: SharedControlPanelCapability) {
	return value === "view" || value === "query-rerun" || value === "subscribe";
}
function validateRevision(v: SharedControlPanelRevision) {
	exactKeys(v, [
		"kind",
		"pins",
		"previousRevision",
		"title",
		"frames",
		"widgets",
		"immutableRefs",
		"createdBy",
		"createdAtMs",
	]);
	if (v.kind !== "shared-control-panel-revision")
		throw new TypeError("invalid-panel-revision-kind");
	validatePins(v.pins);
	optionalIdentity(v.previousRevision, "previousRevision");
	identity(v.title, "title");
	identity(v.createdBy, "createdBy");
	timestamp(v.createdAtMs);
	if (
		!Array.isArray(v.frames) ||
		!Array.isArray(v.widgets) ||
		!Array.isArray(v.immutableRefs) ||
		v.frames.length > 64 ||
		v.widgets.length > 64 ||
		v.immutableRefs.length > 64
	)
		throw new TypeError("invalid-panel-bounds");
	denseArray(v.frames, "frames");
	denseArray(v.widgets, "widgets");
	denseArray(v.immutableRefs, "immutableRefs");
	const frames = new Set<string>();
	for (const frame of v.frames) {
		exactKeys(frame, ["frameId", "x", "y", "width", "height"]);
		identity(frame.frameId, "frameId");
		for (const n of [frame.x, frame.y, frame.width, frame.height])
			if (typeof n !== "number" || !Number.isFinite(n))
				throw new TypeError("invalid-frame-coordinate");
		if (
			typeof frame.width !== "number" ||
			typeof frame.height !== "number" ||
			frame.width <= 0 ||
			frame.height <= 0 ||
			frames.has(frame.frameId)
		)
			throw new TypeError("invalid-frame");
		frames.add(frame.frameId);
	}
	const widgets = new Set<string>();
	for (const widget of v.widgets) {
		exactKeys(widget, ["widgetId", "frameId", "bindingKind", "bindingRef", "displayRevision"]);
		identity(widget.widgetId, "widgetId");
		identity(widget.frameId, "frameId");
		identity(widget.bindingRef, "bindingRef");
		identity(widget.displayRevision, "displayRevision");
		if (
			!frames.has(widget.frameId) ||
			widgets.has(widget.widgetId) ||
			typeof widget.bindingKind !== "string" ||
			!["answer", "topology", "input", "status"].includes(widget.bindingKind)
		)
			throw new TypeError("invalid-widget");
		widgets.add(widget.widgetId);
	}
	for (const ref of v.immutableRefs) sourceRef(ref);
	return snapshot(v);
}
function validatePins(v: SharedControlPanelPins) {
	exactKeys(v, [
		"tenantId",
		"workspaceId",
		"workGraphId",
		"panelId",
		"panelRevision",
		"queryRevision",
		"specRevision",
		"sourceRevision",
		"schemaRevision",
		"artifactRevision",
		"inputRevision",
		"topologyFingerprint",
		"policyRevision",
		"redactionRevision",
		"environmentId",
		"environmentRevision",
		"runId",
		"requestId",
		"attempt",
		"outcomeId",
		"runHighWater",
		"evidenceHighWater",
		"freshnessHighWater",
	]);
	for (const [k, x] of Object.entries(v))
		if (["attempt", "runHighWater", "evidenceHighWater", "freshnessHighWater"].includes(k)) {
			if (!Number.isSafeInteger(x) || Number(x) < 0) throw new TypeError(`invalid-${k}`);
		} else identity(x, k);
}
function validateGrant(v: unknown): SharedControlPanelGrant {
	exactKeys(v, [
		"kind",
		"grantId",
		"tenantId",
		"panelId",
		"panelRevision",
		"subjectId",
		"capability",
		"capabilityRevision",
		"policyRevision",
		"redactionRevision",
		"issuedAtMs",
		"expiresAtMs",
		"revokedAtMs",
		"actorSessionRevision",
	]);
	const x = v as unknown as SharedControlPanelGrant;
	if (x.kind !== "shared-control-panel-grant" || !capabilities.includes(x.capability))
		throw new TypeError("invalid-grant");
	for (const [k, y] of Object.entries(x))
		if (k.endsWith("AtMs")) {
			if (y !== null) timestamp(y as number);
		} else if (k !== "kind" && k !== "capability") identity(y, k);
	if (x.expiresAtMs <= x.issuedAtMs) throw new TypeError("invalid-grant-expiry");
	return snapshot(x);
}
function validateTruth(v: SharedControlPanelCurrentTruth) {
	exactKeys(v, [
		"kind",
		"pins",
		"subjectId",
		"grantId",
		"capability",
		"capabilityRevision",
		"currentPolicyRevision",
		"currentRedactionRevision",
		"actorSessionRevision",
		"observedAtMs",
	]);
	if (v.kind !== "shared-control-panel-current-truth") throw new TypeError("invalid-current-truth");
	validatePins(v.pins);
	identity(v.subjectId, "subjectId");
	identity(v.grantId, "grantId");
	if (!capabilities.includes(v.capability)) throw new TypeError("invalid-capability");
	identity(v.capabilityRevision, "capabilityRevision");
	identity(v.currentPolicyRevision, "policyRevision");
	identity(v.currentRedactionRevision, "redactionRevision");
	identity(v.actorSessionRevision, "actorSessionRevision");
	timestamp(v.observedAtMs);
}
function validateSubscription(v: SharedControlPanelSubscriptionRevision) {
	exactKeys(v, [
		"kind",
		"tenantId",
		"subscriptionId",
		"subscriptionRevision",
		"previousRevision",
		"panelId",
		"panelRevision",
		"subjectId",
		"pins",
		"grantId",
		"capabilityRevision",
		"actorSessionRevision",
		"intervalMs",
		"scheduleAnchorMs",
		"expiresAtMs",
		"condition",
		"conditionRevision",
		"staleAfterMs",
		"anomalyThreshold",
		"cooldownMs",
		"rateCap",
		"policyRevision",
		"redactionRevision",
		"active",
		"effectiveAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-subscription-revision" ||
		!["stale", "anomaly"].includes(v.condition)
	)
		throw new TypeError("invalid-subscription");
	for (const [k, x] of Object.entries(v)) {
		if (
			[
				"intervalMs",
				"staleAfterMs",
				"cooldownMs",
				"rateCap",
				"effectiveAtMs",
				"scheduleAnchorMs",
				"expiresAtMs",
			].includes(k)
		) {
			if (!Number.isSafeInteger(x) || Number(x) < 0) throw new TypeError(`invalid-${k}`);
		} else if (k === "anomalyThreshold") {
			if (typeof x !== "number" || !Number.isFinite(x) || x < 0)
				throw new TypeError("invalid-anomaly-threshold");
		} else if (k === "pins") validatePins(x as SharedControlPanelPins);
		else if (k !== "kind" && k !== "condition" && k !== "active" && k !== "previousRevision")
			identity(x, k);
	}
	optionalIdentity(v.previousRevision, "previousRevision");
	if (v.intervalMs < 60_000 || v.rateCap < 1 || v.expiresAtMs <= v.effectiveAtMs)
		throw new TypeError("unsafe-subscription-bounds");
	return snapshot(v);
}
function validateHostSubscriptionRequest(
	v: SharedControlPanelHostSubscriptionRequest,
): SharedControlPanelHostSubscriptionRequest {
	exactKeys(v, ["kind", "intent", "revision", "admittedAtMs", "bindingAuthorityFingerprint"]);
	if (v.kind !== "shared-control-panel-host-subscription-request")
		throw new TypeError("invalid-host-subscription-request");
	const sub = validateSubscription(v.revision);
	const intent = v.intent;
	validateCanvasSubscriptionIntentEnvelope(intent);
	if (
		intent.kind !== "workspace-shared-control-panel-subscription-intent" ||
		intent.contractVersion !== "1" ||
		!["create", "pause", "resume", "revoke"].includes(intent.action)
	)
		throw new TypeError("invalid-canvas-subscription-intent");
	identity(intent.intentId, "intentId");
	identity(intent.idempotencyKey, "idempotencyKey");
	timestamp(v.admittedAtMs);
	identity(v.bindingAuthorityFingerprint, "bindingAuthorityFingerprint");
	const safeBinding = validateCanvasSubscriptionBinding(intent.binding, sub);
	if (v.bindingAuthorityFingerprint !== boundedFingerprint(safeBinding))
		throw new TypeError("subscription-binding-authority-fingerprint-mismatch");
	if (v.admittedAtMs !== sub.effectiveAtMs)
		throw new TypeError("subscription-admission-time-mismatch");
	const create = intent.action === "create";
	if (
		(create &&
			(sub.previousRevision !== null ||
				!sub.active ||
				intent.subscription !== undefined ||
				intent.intervalSeconds !== sub.intervalMs / 1_000 ||
				intent.condition !== sub.condition)) ||
		(!create &&
			(sub.previousRevision === null ||
				intent.intervalSeconds !== undefined ||
				intent.condition !== undefined ||
				!intent.subscription ||
				intent.subscription.id !== sub.subscriptionId ||
				intent.subscription.revision !== sub.previousRevision ||
				(intent.action === "resume") !== sub.active))
	)
		throw new TypeError("subscription-intent-revision-mismatch");
	return snapshot(v);
}
function validateCanvasSubscriptionBinding(
	v: SharedControlPanelCanvasSubscriptionBinding,
	sub: SharedControlPanelSubscriptionRevision,
): SharedControlPanelCanvasSubscriptionBinding {
	const coordinateKeys = [
		"tenant",
		"workspace",
		"workGraph",
		"panel",
		"panelHead",
		"panelRevision",
		"sourceRequest",
		"sourceRun",
		"sourceOutcome",
		"queryPlan",
		"spec",
		"input",
		"source",
		"schema",
		"evidence",
		"artifact",
		"actorSession",
		"actorSubject",
		"actorGrant",
		"actorCapabilitySet",
		"capabilityRevision",
		"actorAdmission",
		"issuedAt",
		"expiresAt",
		"policy",
		"redaction",
	] as const;
	exactKeys(v, [
		"capability",
		...coordinateKeys,
		"attempt",
		"topologyFingerprint",
		"terminalHighWater",
		"evidenceHighWater",
		"artifactHighWater",
		"freshnessHighWater",
	]);
	if (v.capability !== "subscribe") throw new TypeError("subscribe-binding-required");
	for (const key of coordinateKeys) {
		exactKeys(v[key], ["id", "revision"]);
		identity(v[key].id, `${key}Id`);
		identity(v[key].revision, `${key}Revision`);
	}
	if (!Number.isSafeInteger(v.attempt) || v.attempt < 0)
		throw new TypeError("invalid-binding-attempt");
	for (const [key, value] of [
		["topologyFingerprint", v.topologyFingerprint],
		["terminalHighWater", v.terminalHighWater],
		["evidenceHighWater", v.evidenceHighWater],
		["artifactHighWater", v.artifactHighWater],
		["freshnessHighWater", v.freshnessHighWater],
	] as const)
		identity(value, key);
	const p = sub.pins;
	const mismatched =
		v.tenant.id !== p.tenantId ||
		v.workspace.id !== p.workspaceId ||
		v.workGraph.id !== p.workGraphId ||
		v.panel.id !== p.panelId ||
		v.panelRevision.revision !== p.panelRevision ||
		v.sourceRequest.id !== p.requestId ||
		v.sourceRun.id !== p.runId ||
		v.sourceOutcome.id !== p.outcomeId ||
		v.queryPlan.revision !== p.queryRevision ||
		v.spec.revision !== p.specRevision ||
		v.input.revision !== p.inputRevision ||
		v.source.revision !== p.sourceRevision ||
		v.schema.revision !== p.schemaRevision ||
		v.artifact.revision !== p.artifactRevision ||
		v.actorSession.revision !== sub.actorSessionRevision ||
		v.actorSubject.id !== sub.subjectId ||
		v.actorGrant.id !== sub.grantId ||
		v.actorGrant.revision !== sub.capabilityRevision ||
		canonical(v.actorCapabilitySet) !== canonical(v.capabilityRevision) ||
		v.capabilityRevision.revision !== sub.capabilityRevision ||
		v.policy.revision !== sub.policyRevision ||
		v.redaction.revision !== sub.redactionRevision ||
		v.attempt !== p.attempt ||
		v.topologyFingerprint !== p.topologyFingerprint ||
		v.terminalHighWater !== String(p.runHighWater) ||
		v.evidenceHighWater !== String(p.evidenceHighWater) ||
		v.freshnessHighWater !== String(p.freshnessHighWater);
	if (mismatched) throw new TypeError("canvas-subscription-binding-mismatch");
	return snapshot(v);
}
function validateCanvasSubscriptionIntentEnvelope(v: SharedControlPanelCanvasSubscriptionIntent) {
	exactKeys(
		v,
		[
			"kind",
			"contractVersion",
			"intentId",
			"idempotencyKey",
			"action",
			"binding",
			"subscription",
			"intervalSeconds",
			"condition",
		],
		["subscription", "intervalSeconds", "condition"],
	);
}
function validateOccurrence(v: unknown): SharedControlPanelOccurrence {
	exactKeys(v, [
		"kind",
		"tenantId",
		"occurrenceId",
		"subscriptionId",
		"subscriptionRevision",
		"conditionRevision",
		"panelId",
		"panelRevision",
		"dueAtMs",
		"claimedAtMs",
		"admissionFingerprint",
		"state",
		"reason",
		"candidate",
		"completed",
		"evaluation",
	]);
	const x = v as unknown as SharedControlPanelOccurrence;
	if (
		x.kind !== "shared-control-panel-occurrence" ||
		!["claimed", "candidate-created", "completed", "evaluated"].includes(x.state)
	)
		throw new TypeError("invalid-occurrence");
	for (const [k, y] of Object.entries(x))
		if (k.endsWith("AtMs")) timestamp(y as number);
		else if (
			k !== "kind" &&
			k !== "state" &&
			k !== "candidate" &&
			k !== "completed" &&
			k !== "evaluation"
		)
			identity(y, k);
	if (x.candidate !== null) validateCandidate(x.candidate, x, x.candidate.createdAtMs);
	if (x.completed !== null) validateCompleted(x.completed, x, x.completed.completedAtMs);
	if (x.evaluation !== null) validateEvaluation(x.evaluation);
	return snapshot(x);
}
function validateEvaluation(v: SharedControlPanelOccurrenceEvaluation) {
	exactKeys(v, [
		"kind",
		"evidenceFingerprint",
		"conditionRevision",
		"policyRevision",
		"decisionFingerprint",
		"alertId",
		"suppressionId",
		"evaluatedAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-occurrence-evaluation" ||
		(v.alertId === null) === (v.suppressionId === null)
	)
		throw new TypeError("invalid-occurrence-evaluation");
	identity(v.evidenceFingerprint, "evidenceFingerprint");
	identity(v.conditionRevision, "conditionRevision");
	identity(v.policyRevision, "policyRevision");
	identity(v.decisionFingerprint, "decisionFingerprint");
	optionalIdentity(v.alertId, "alertId");
	optionalIdentity(v.suppressionId, "suppressionId");
	timestamp(v.evaluatedAtMs);
}
function validateSignal(v: SharedControlPanelSignal) {
	exactKeys(v, [
		"observedAtMs",
		"lastSuccessfulRunAtMs",
		"value",
		"baseline",
		"evidenceFingerprint",
		"evidenceRefs",
	]);
	timestamp(v.observedAtMs);
	timestamp(v.lastSuccessfulRunAtMs);
	if (!Number.isFinite(v.value) || !Number.isFinite(v.baseline))
		throw new TypeError("invalid-signal-value");
	identity(v.evidenceFingerprint, "evidenceFingerprint");
	if (!Array.isArray(v.evidenceRefs) || v.evidenceRefs.length > 32)
		throw new TypeError("invalid-evidence-refs");
	for (const r of v.evidenceRefs) sourceRef(r);
}
function validateCandidate(
	v: SharedControlPanelCandidate,
	o: SharedControlPanelOccurrence,
	now: number,
) {
	exactKeys(v, ["kind", "occurrenceId", "request", "createdAtMs"]);
	if (
		v.kind !== "shared-control-panel-run-candidate" ||
		v.occurrenceId !== o.occurrenceId ||
		v.createdAtMs !== now
	)
		throw new TypeError("invalid-fresh-run-candidate");
	validateCandidateRequest(v.request);
}
function validateCandidateRequest(v: ToolProviderAdapterRunRequested) {
	exactKeys(
		v,
		[
			"kind",
			"runId",
			"adapterInputId",
			"requestId",
			"operationId",
			"routeId",
			"providerId",
			"executorId",
			"profileId",
			"attempt",
			"reason",
			"retryOfOutcomeId",
			"policyRefs",
			"sourceRefs",
			"requestedAtMs",
			"metadata",
		],
		[
			"routeId",
			"providerId",
			"executorId",
			"profileId",
			"retryOfOutcomeId",
			"policyRefs",
			"sourceRefs",
			"requestedAtMs",
			"metadata",
		],
	);
	if (
		v.kind !== "tool-provider-adapter-run-requested" ||
		!Number.isSafeInteger(v.attempt) ||
		v.attempt < 0
	)
		throw new TypeError("invalid-candidate-request");
	for (const x of [v.runId, v.adapterInputId, v.requestId, v.operationId, v.reason])
		identity(x, "candidate-coordinate");
	for (const x of [v.routeId, v.providerId, v.executorId, v.profileId, v.retryOfOutcomeId])
		if (x !== undefined) identity(x, "candidate-coordinate");
	for (const refs of [v.policyRefs, v.sourceRefs])
		if (refs) {
			if (!Array.isArray(refs) || refs.length > 32) throw new TypeError("candidate-refs-too-large");
			for (const ref of refs) sourceRef(ref);
		}
	if (v.requestedAtMs !== undefined) timestamp(v.requestedAtMs);
	if (v.metadata !== undefined) validateEnvironmentPinnedMetadata(v.metadata);
}
function validateEnvironmentPinnedMetadata(v: Record<string, unknown>) {
	exactKeys(
		v,
		[
			"executionEnvironmentId",
			"executionEnvironmentRevision",
			"executionEnvironmentLocality",
			"executionEnvironmentBindingKind",
			"executionSessionEpoch",
			"executionManifestFingerprint",
		],
		["executionManifestFingerprint"],
	);
	for (const key of [
		"executionEnvironmentId",
		"executionEnvironmentRevision",
		"executionSessionEpoch",
	] as const)
		identity(v[key], key);
	if (
		!["local", "managed-cloud", "customer-hosted"].includes(
			v.executionEnvironmentLocality as string,
		)
	)
		throw new TypeError("invalid-execution-environment-locality");
	if (
		!["local-host-process", "local-container", "remote-session"].includes(
			v.executionEnvironmentBindingKind as string,
		)
	)
		throw new TypeError("invalid-execution-environment-binding-kind");
	if (v.executionManifestFingerprint !== undefined)
		identity(v.executionManifestFingerprint, "executionManifestFingerprint");
}
function validateAlert(
	v: SharedControlPanelAlert,
	o: SharedControlPanelOccurrence,
	s: SharedControlPanelSignal,
	now: number,
	sub?: SharedControlPanelSubscriptionRevision,
) {
	exactKeys(v, [
		"kind",
		"alertId",
		"tenantId",
		"occurrenceId",
		"subscriptionId",
		"subscriptionRevision",
		"conditionRevision",
		"panelId",
		"panelRevision",
		"condition",
		"evidenceFingerprint",
		"evidenceRefs",
		"createdAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-alert" ||
		v.tenantId !== o.tenantId ||
		v.occurrenceId !== o.occurrenceId ||
		v.subscriptionId !== o.subscriptionId ||
		v.subscriptionRevision !== o.subscriptionRevision ||
		v.conditionRevision !== o.conditionRevision ||
		v.panelId !== o.panelId ||
		v.panelRevision !== o.panelRevision ||
		(sub !== undefined &&
			(v.condition !== sub.condition || v.conditionRevision !== sub.conditionRevision)) ||
		v.evidenceFingerprint !== s.evidenceFingerprint ||
		v.createdAtMs !== now
	)
		throw new TypeError("invalid-alert");
	if (v.evidenceRefs.length > 32) throw new TypeError("alert-evidence-too-large");
	denseArray(v.evidenceRefs, "alertEvidenceRefs");
	for (const ref of v.evidenceRefs) sourceRef(ref);
}
function validateCompleted(
	v: SharedControlPanelCompletedOccurrence,
	o: SharedControlPanelOccurrence,
	now: number,
) {
	exactKeys(v, [
		"kind",
		"occurrenceId",
		"candidateRequestId",
		"candidateRunId",
		"admissionId",
		"admissionSourceRefs",
		"runId",
		"attempt",
		"outcomeId",
		"terminalHighWater",
		"outcomeEvidenceFingerprint",
		"evidenceRefs",
		"completedAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-completed-occurrence" ||
		v.occurrenceId !== o.occurrenceId ||
		v.completedAtMs !== now ||
		!Number.isSafeInteger(v.attempt) ||
		!Number.isSafeInteger(v.terminalHighWater)
	)
		throw new TypeError("invalid-completed-occurrence");
	for (const x of [v.candidateRequestId, v.candidateRunId, v.admissionId, v.runId, v.outcomeId])
		identity(x, "completed-coordinate");
	if (
		!Array.isArray(v.admissionSourceRefs) ||
		v.admissionSourceRefs.length === 0 ||
		v.admissionSourceRefs.length > 16
	)
		throw new TypeError("invalid-admission-source-refs");
	for (const ref of v.admissionSourceRefs) sourceRef(ref);
	identity(v.outcomeEvidenceFingerprint, "outcomeEvidenceFingerprint");
	if (!Array.isArray(v.evidenceRefs) || v.evidenceRefs.length > 32)
		throw new TypeError("invalid-completed-evidence");
	for (const ref of v.evidenceRefs) sourceRef(ref);
}
function validateAlertStored(
	v: unknown,
	d: SharedControlPanelInboxDelivery,
	truth: SharedControlPanelCurrentTruth,
) {
	exactKeys(v, [
		"kind",
		"alertId",
		"tenantId",
		"occurrenceId",
		"subscriptionId",
		"subscriptionRevision",
		"conditionRevision",
		"panelId",
		"panelRevision",
		"condition",
		"evidenceFingerprint",
		"evidenceRefs",
		"createdAtMs",
	]);
	const a = v as unknown as SharedControlPanelAlert;
	if (
		a.kind !== "shared-control-panel-alert" ||
		a.tenantId !== d.tenantId ||
		a.alertId !== d.alertId ||
		a.panelId !== truth.pins.panelId ||
		a.panelRevision !== truth.pins.panelRevision
	)
		throw new TypeError("invalid-stored-alert");
	if (!Array.isArray(a.evidenceRefs) || a.evidenceRefs.length > 32)
		throw new TypeError("invalid-stored-alert-evidence");
	denseArray(a.evidenceRefs, "storedAlertEvidenceRefs");
	for (const ref of a.evidenceRefs) sourceRef(ref);
}
function validateSuppression(
	v: SharedControlPanelSuppression,
	o: SharedControlPanelOccurrence,
	s: SharedControlPanelSignal,
	sub: SharedControlPanelSubscriptionRevision,
	now: number,
) {
	exactKeys(v, [
		"kind",
		"suppressionId",
		"tenantId",
		"occurrenceId",
		"subscriptionId",
		"subscriptionRevision",
		"conditionRevision",
		"evidenceFingerprint",
		"reason",
		"policyRevision",
		"createdAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-suppression" ||
		v.tenantId !== o.tenantId ||
		v.occurrenceId !== o.occurrenceId ||
		v.subscriptionId !== o.subscriptionId ||
		v.subscriptionRevision !== o.subscriptionRevision ||
		v.conditionRevision !== sub.conditionRevision ||
		v.evidenceFingerprint !== s.evidenceFingerprint ||
		v.policyRevision !== sub.policyRevision ||
		v.createdAtMs !== now ||
		!["condition-false", "cooldown", "rate-cap", "duplicate"].includes(v.reason)
	)
		throw new TypeError("invalid-suppression");
	identity(v.suppressionId, "suppressionId");
}
function validateDelivery(v: unknown): SharedControlPanelInboxDelivery {
	exactKeys(v, [
		"kind",
		"deliveryId",
		"tenantId",
		"alertId",
		"recipientId",
		"redactionRevision",
		"state",
		"createdAtMs",
		"deliveredAtMs",
		"terminalAtMs",
	]);
	const x = v as unknown as SharedControlPanelInboxDelivery;
	if (
		x.kind !== "shared-control-panel-inbox-delivery" ||
		!["pending", "attempted", "delivered", "failed", "suppressed", "expired"].includes(x.state)
	)
		throw new TypeError("invalid-delivery");
	for (const [k, y] of Object.entries(x))
		if (k.endsWith("AtMs")) {
			if (y !== null) timestamp(y as number);
		} else if (k !== "kind" && k !== "state") identity(y, k);
	if (
		(x.state === "pending" || x.state === "attempted") &&
		(x.deliveredAtMs !== null || x.terminalAtMs !== null)
	)
		throw new TypeError("invalid-delivery-timestamps");
	if (x.state === "delivered" && (x.deliveredAtMs === null || x.terminalAtMs !== x.deliveredAtMs))
		throw new TypeError("invalid-delivery-timestamps");
	if (
		["failed", "suppressed", "expired"].includes(x.state) &&
		(x.deliveredAtMs !== null || x.terminalAtMs === null)
	)
		throw new TypeError("invalid-delivery-timestamps");
	return snapshot(x);
}
function validateAudit(v: unknown): SharedControlPanelAuditEntry {
	plain(v);
	const x = v as unknown as SharedControlPanelAuditEntry;
	if (x.kind !== "shared-control-panel-audit" || !Number.isSafeInteger(x.sequence))
		throw new TypeError("invalid-audit");
	return snapshot(x);
}
async function storedAuthorization(
	c: SharedControlPanelSqlClient,
	pins: SharedControlPanelPins,
	grantId: string,
	subject: string,
	capability: SharedControlPanelCapability,
	capRev: string,
	session: string,
	policy: string,
	redaction: string,
	now: number,
): Promise<SharedControlPanelStoreResult<SharedControlPanelGrant>> {
	const row = await c.query(
		`SELECT g.body AS grant_body,r.body AS panel_body,ct.body AS truth_body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.grants g JOIN ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_heads h ON h.tenant_id=$1 AND h.panel_id=$2 JOIN ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_revisions r ON r.tenant_id=h.tenant_id AND r.panel_id=h.panel_id AND r.panel_revision=h.panel_revision JOIN ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.canonical_truth ct ON ct.tenant_id=h.tenant_id AND ct.panel_id=h.panel_id WHERE g.tenant_id=$1 AND g.grant_id=$3 FOR UPDATE`,
		[pins.tenantId, pins.panelId, grantId],
	);
	if (!row.rowCount) return rejected("grant-or-current-panel-missing");
	const g = validateGrant(row.rows[0]?.grant_body);
	const r = validateRevision(row.rows[0]?.panel_body as SharedControlPanelRevision);
	const current = validateCanonicalTruth(
		row.rows[0]?.truth_body as SharedControlPanelCanonicalTruth,
	);
	if (
		canonical(r.pins) !== canonical(pins) ||
		canonical(current.pins) !== canonical(pins) ||
		g.tenantId !== pins.tenantId ||
		g.panelId !== pins.panelId ||
		g.panelRevision !== pins.panelRevision ||
		g.subjectId !== subject ||
		g.capability !== capability ||
		g.capabilityRevision !== capRev ||
		g.actorSessionRevision !== session ||
		g.policyRevision !== policy ||
		g.redactionRevision !== redaction ||
		g.revokedAtMs !== null ||
		now >= g.expiresAtMs
	)
		return rejected("authorization-stale-or-denied");
	return accepted("authorized", g);
}
async function currentSubscription(
	c: SharedControlPanelSqlClient,
	sub: SharedControlPanelSubscriptionRevision,
): Promise<SharedControlPanelStoreResult<SharedControlPanelSubscriptionRevision>> {
	const row = await c.query(
		`SELECT s.body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscription_heads h JOIN ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.subscriptions s ON s.tenant_id=h.tenant_id AND s.subscription_id=h.subscription_id AND s.subscription_revision=h.subscription_revision WHERE h.tenant_id=$1 AND h.subscription_id=$2 AND h.subscription_revision=$3 FOR UPDATE`,
		[sub.tenantId, sub.subscriptionId, sub.subscriptionRevision],
	);
	if (!row.rowCount) return rejected("stale-subscription-revision");
	return sameOrConflict(
		row.rows[0]?.body,
		sub,
		"current-subscription",
		"subscription-body-conflict",
	);
}
async function lockOccurrence(c: SharedControlPanelSqlClient, o: SharedControlPanelOccurrence) {
	const row = await c.query(
		`SELECT body FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.occurrences WHERE tenant_id=$1 AND subscription_id=$2 AND subscription_revision=$3 AND due_at_ms=$4 FOR UPDATE`,
		[o.tenantId, o.subscriptionId, o.subscriptionRevision, o.dueAtMs],
	);
	if (!row.rowCount || canonical(validateOccurrence(row.rows[0]?.body)) !== canonical(o))
		return rejected<SharedControlPanelOccurrence>("stale-occurrence");
	return accepted("occurrence-locked", o);
}
async function updateOccurrence(
	c: SharedControlPanelSqlClient,
	o: SharedControlPanelOccurrence,
	state: SharedControlPanelOccurrence["state"],
	reason: string,
	now: number,
	patch: Partial<Pick<SharedControlPanelOccurrence, "candidate" | "completed" | "evaluation">> = {},
) {
	const next = snapshot({ ...o, ...patch, state, reason });
	const r = await c.query(
		`UPDATE ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.occurrences SET body=$5::jsonb WHERE tenant_id=$1 AND subscription_id=$2 AND subscription_revision=$3 AND due_at_ms=$4`,
		[o.tenantId, o.subscriptionId, o.subscriptionRevision, o.dueAtMs, json(next)],
	);
	if (r.rowCount !== 1) return rejected<SharedControlPanelOccurrence>("occurrence-cas-conflict");
	await writeAudit(c, o.tenantId, "host", o.occurrenceId, state, now);
	return accepted(state, next);
}
async function currentPanel(c: SharedControlPanelSqlClient, t: string, p: string) {
	const r = await c.query(
		`SELECT panel_revision FROM ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.panel_heads WHERE tenant_id=$1 AND panel_id=$2 FOR UPDATE`,
		[t, p],
	);
	return r.rows[0]?.panel_revision ?? null;
}
async function writeAudit(
	c: SharedControlPanelSqlClient,
	t: string,
	s: string,
	o: string,
	k: string,
	at: number,
) {
	const body = {
		kind: "shared-control-panel-audit",
		tenantId: t,
		eventId: `${k}:${o}:${at}`,
		eventKind: k,
		subjectId: s,
		objectId: o,
		occurredAtMs: at,
	};
	await c.query(
		`INSERT INTO ${POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA}.audit (tenant_id,body) VALUES ($1,$2::jsonb)`,
		[t, json(body)],
	);
}
const capabilities: readonly SharedControlPanelCapability[] = [
	"view",
	"query-rerun",
	"download",
	"input",
	"subscribe",
	"action",
];
function sourceRef(v: SourceRef) {
	exactKeys(v, ["kind", "id"]);
	identity(v.kind, "sourceRef.kind");
	identity(v.id, "sourceRef.id");
}
function clockNow(clock: SharedControlPanelHostClock): number {
	const value = clock.now();
	timestamp(value);
	return value;
}
function validateCanonicalTruth(v: SharedControlPanelCanonicalTruth) {
	exactKeys(v, ["kind", "pins", "recordedAtMs"]);
	if (v.kind !== "shared-control-panel-canonical-truth")
		throw new TypeError("invalid-canonical-truth");
	validatePins(v.pins);
	timestamp(v.recordedAtMs);
	return snapshot(v);
}
function truthScope(p: SharedControlPanelPins) {
	const {
		runId: _r,
		attempt: _a,
		outcomeId: _o,
		runHighWater: _rh,
		evidenceHighWater: _eh,
		freshnessHighWater: _fh,
		...scope
	} = p;
	return scope;
}
function validateRecordedAdmission(v: SharedControlPanelRecordedAdmission) {
	exactKeys(v, [
		"kind",
		"tenantId",
		"occurrenceId",
		"admission",
		"bodyFingerprint",
		"recordedAtMs",
	]);
	if (v.kind !== "shared-control-panel-recorded-admission")
		throw new TypeError("invalid-recorded-admission");
	identity(v.occurrenceId, "occurrenceId");
	identity(v.tenantId, "tenantId");
	identity(v.bodyFingerprint, "bodyFingerprint");
	timestamp(v.recordedAtMs);
	validateAdmission(v.admission);
	if (v.bodyFingerprint !== sharedControlPanelAdmissionFingerprint(v.admission))
		throw new TypeError("admission-body-fingerprint-mismatch");
	return snapshot(v);
}
function validateRecordedTerminalOutcome(v: SharedControlPanelRecordedTerminalOutcome) {
	exactKeys(v, [
		"kind",
		"tenantId",
		"occurrenceId",
		"runId",
		"attempt",
		"outcomeId",
		"terminalHighWater",
		"outcomeEvidenceFingerprint",
		"evidenceRefs",
		"recordedAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-recorded-terminal-outcome" ||
		!Number.isSafeInteger(v.attempt) ||
		v.attempt < 0 ||
		!Number.isSafeInteger(v.terminalHighWater) ||
		v.terminalHighWater < 0
	)
		throw new TypeError("invalid-recorded-terminal-outcome");
	for (const x of [v.tenantId, v.occurrenceId, v.runId, v.outcomeId, v.outcomeEvidenceFingerprint])
		identity(x, "terminal-outcome-coordinate");
	timestamp(v.recordedAtMs);
	if (!Array.isArray(v.evidenceRefs) || v.evidenceRefs.length === 0 || v.evidenceRefs.length > 32)
		throw new TypeError("invalid-terminal-outcome-evidence");
	denseArray(v.evidenceRefs, "terminalOutcomeEvidenceRefs");
	for (const ref of v.evidenceRefs) sourceRef(ref);
	if (!v.evidenceRefs.some((ref) => ref.kind === "executor-outcome" && ref.id === v.outcomeId))
		throw new TypeError("terminal-outcome-ref-missing");
	return snapshot(v);
}
function validateAdmission(v: ToolProviderRunAdmission) {
	exactKeys(
		v,
		[
			"kind",
			"admissionId",
			"proposalId",
			"runId",
			"adapterInputId",
			"requestId",
			"operationId",
			"state",
			"decisionId",
			"approvedRunId",
			"reason",
			"sourceRefs",
			"metadata",
		],
		["reason", "sourceRefs", "metadata"],
	);
	if (
		v.kind !== "tool-provider-run-admission" ||
		v.state !== "admitted" ||
		!v.approvedRunId ||
		!v.decisionId
	)
		throw new TypeError("invalid-d419-admission");
	for (const x of [
		v.admissionId,
		v.proposalId,
		v.runId,
		v.adapterInputId,
		v.requestId,
		v.operationId,
		v.decisionId,
		v.approvedRunId,
	])
		identity(x, "admission-coordinate");
	if (v.sourceRefs) {
		if (!Array.isArray(v.sourceRefs) || v.sourceRefs.length > 32)
			throw new TypeError("invalid-admission-refs");
		for (const ref of v.sourceRefs) sourceRef(ref);
	}
	if (v.metadata !== undefined) validateAdmissionMetadata(v.metadata);
}
function validateAdmissionMetadata(v: Record<string, unknown>) {
	exactKeys(v, ["approvalMode", "occurredAtMs"], ["occurredAtMs"]);
	identity(v.approvalMode, "approvalMode");
	if (v.occurredAtMs !== undefined) timestamp(v.occurredAtMs as number);
}
function validateQueryRerun(v: SharedControlPanelQueryRerunRequest) {
	exactKeys(v, [
		"kind",
		"rerunId",
		"idempotencyKey",
		"truth",
		"candidate",
		"binding",
		"requestedAtMs",
	]);
	if (v.kind !== "shared-control-panel-query-rerun-request")
		throw new TypeError("invalid-query-rerun");
	identity(v.rerunId, "rerunId");
	identity(v.idempotencyKey, "idempotencyKey");
	validateTruth(v.truth);
	if (v.truth.capability !== "query-rerun") throw new TypeError("query-rerun-capability-required");
	validateCandidate(
		v.candidate,
		{
			kind: "shared-control-panel-occurrence",
			tenantId: v.truth.pins.tenantId,
			occurrenceId: v.candidate.occurrenceId,
			subscriptionId: "interactive-rerun",
			subscriptionRevision: "interactive-rerun-v1",
			conditionRevision: "interactive-rerun-v1",
			panelId: v.truth.pins.panelId,
			panelRevision: v.truth.pins.panelRevision,
			dueAtMs: v.requestedAtMs,
			claimedAtMs: v.requestedAtMs,
			admissionFingerprint: "interactive",
			state: "claimed",
			reason: "interactive",
			candidate: null,
			completed: null,
			evaluation: null,
		},
		v.requestedAtMs,
	);
	validateQueryRerunBinding(v.binding, v.truth.pins);
	const request = v.candidate.request;
	if (
		request.runId === v.truth.pins.runId ||
		request.requestId === v.truth.pins.requestId ||
		request.attempt !== 1 ||
		request.retryOfOutcomeId !== undefined ||
		request.reason !== "shared-control-panel-query-rerun" ||
		request.requestedAtMs !== v.requestedAtMs
	)
		throw new TypeError("query-rerun-not-fresh");
	const metadata = request.metadata as Record<string, unknown> | undefined;
	if (
		!metadata ||
		metadata.executionEnvironmentId !== v.truth.pins.environmentId ||
		metadata.executionEnvironmentRevision !== v.truth.pins.environmentRevision
	)
		throw new TypeError("query-rerun-environment-pins-mismatch");
	timestamp(v.requestedAtMs);
}
function validateQueryRerunBinding(
	v: SharedControlPanelQueryRerunBinding,
	p: SharedControlPanelPins,
) {
	exactKeys(v, [
		"tenantId",
		"workspaceId",
		"workGraphId",
		"panelId",
		"panelRevision",
		"priorRequestId",
		"priorRunId",
		"priorOutcomeId",
		"queryRevision",
		"specRevision",
		"inputRevision",
		"sourceRevision",
		"policyRevision",
	]);
	const expected = {
		tenantId: p.tenantId,
		workspaceId: p.workspaceId,
		workGraphId: p.workGraphId,
		panelId: p.panelId,
		panelRevision: p.panelRevision,
		priorRequestId: p.requestId,
		priorRunId: p.runId,
		priorOutcomeId: p.outcomeId,
		queryRevision: p.queryRevision,
		specRevision: p.specRevision,
		inputRevision: p.inputRevision,
		sourceRevision: p.sourceRevision,
		policyRevision: p.policyRevision,
	};
	if (canonical(v) !== canonical(expected)) throw new TypeError("query-rerun-binding-mismatch");
}
function plain(v: unknown): asserts v is Record<string, unknown> {
	if (v === null || typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype)
		throw new TypeError("non-plain-shared-control-panel-material");
	for (const d of Object.values(Object.getOwnPropertyDescriptors(v)))
		if ("get" in d || "set" in d) throw new TypeError("accessor-shared-control-panel-material");
}
function exactKeys(
	v: unknown,
	allowed: readonly string[],
	optional: readonly string[] = [],
): asserts v is Record<string, unknown> {
	plain(v);
	const keys = Object.keys(v);
	for (const key of keys)
		if (!allowed.includes(key)) throw new TypeError(`unknown-shared-control-panel-field:${key}`);
	for (const key of allowed)
		if (!optional.includes(key) && !keys.includes(key))
			throw new TypeError(`missing-shared-control-panel-field:${key}`);
}
function denseArray(v: readonly unknown[], name: string) {
	for (let index = 0; index < v.length; index++)
		if (!Object.hasOwn(v, index)) throw new TypeError(`sparse-${name}`);
}
function identity(v: unknown, name: string): asserts v is string {
	if (
		typeof v !== "string" ||
		v.length === 0 ||
		v.length > 512 ||
		[...v].some((character) => character.charCodeAt(0) < 32)
	)
		throw new TypeError(`invalid-${name}`);
}
function optionalIdentity(v: unknown, n: string) {
	if (v !== null) identity(v, n);
}
function timestamp(v: number) {
	if (!Number.isSafeInteger(v) || v < 0) throw new TypeError("invalid-timestamp");
}
function safeSqlInteger(v: unknown, name: string): number {
	const n = typeof v === "string" && /^(0|[1-9]\d*)$/u.test(v) ? Number(v) : v;
	if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
		throw new TypeError(`invalid-sql-${name}`);
	return n;
}
function json(v: unknown) {
	return JSON.stringify(v);
}
function canonical(v: unknown): string {
	return JSON.stringify(canonicalValue(v));
}
function canonicalValue(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(canonicalValue);
	if (v !== null && typeof v === "object") {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(v).sort())
			out[k] = canonicalValue((v as Record<string, unknown>)[k]);
		return out;
	}
	return v;
}
function object(v: unknown): Record<string, unknown> {
	plain(v);
	return v;
}
function accepted<T>(code: string, value: T): SharedControlPanelStoreResult<T> {
	return snapshot({ accepted: true, code, value });
}
function rejected<T = never>(code: string): SharedControlPanelStoreResult<T> {
	return snapshot({ accepted: false, code });
}
function sameOrConflict<T>(
	stored: unknown,
	value: T,
	same: string,
	conflict: string,
): SharedControlPanelStoreResult<T> {
	plain(stored);
	return json(stored) === json(value) ? accepted(same, snapshot(stored) as T) : rejected(conflict);
}
function snapshot<T>(v: T): T {
	return deepFreeze(structuredClone(v));
}
function deepFreeze<T>(v: T): T {
	if (v && typeof v === "object") {
		Object.freeze(v);
		for (const x of Object.values(v)) deepFreeze(x);
	}
	return v;
}
