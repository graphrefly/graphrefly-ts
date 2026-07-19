/** Concrete PostgreSQL-backed managed-cloud PostgreSQL control-plane binding (D605). */
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, parseCanonicalTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import type {
	AgentRuntimeAuditRecord,
	ExecutorOutcome,
	SourceRef,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunStatus,
} from "../orchestration/index.js";
import {
	type PostgresqlQueryToolArguments,
	postgresqlQueryToolArgumentsFromIntent,
} from "./postgresql-tool-provider.js";

export const MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY =
	"graphrefly-managed-cloud-postgresql-v2" as const;
export const MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE =
	"postgresql-16-atomic-control-store-v1" as const;
export const MANAGED_CLOUD_POSTGRESQL_PROTOCOL = "graphrefly-managed-cloud-wss-json-v2" as const;
export const MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION =
	"managed-cloud-postgresql-control-schema-v2" as const;
export const MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE =
	"control-plane-managed-kubernetes" as const;

export type ManagedCloudPostgresqlDeploymentProfile =
	| typeof MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE
	| "single-vm-development"
	| "docker-compose-development"
	| "unverifiable";

export interface ManagedCloudPostgresqlManifest {
	readonly kind: "managed-cloud-postgresql-manifest";
	readonly manifestId: string;
	readonly revision: string;
	readonly fingerprint: string;
	readonly compatibilityRevision: typeof MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY;
	readonly controlStoreCompatibility: typeof MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE;
	readonly controlStoreSchemaRevision: typeof MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION;
	readonly workerProtocolRevision: typeof MANAGED_CLOUD_POSTGRESQL_PROTOCOL;
	readonly recipeRevision: "postgresql-read-only-query-v1";
	readonly queuePolicyRevision: string;
	readonly leasePolicyRevision: string;
	readonly credentialBindingRevision: string;
	readonly deploymentRevision: string;
	readonly deploymentProfile: ManagedCloudPostgresqlDeploymentProfile;
	readonly workerRevision: string;
	readonly leaseDurationMs: number;
	readonly heartbeatDurationMs: number;
	readonly attestationRefs: readonly SourceRef[];
}

export interface ManagedCloudPostgresqlReadiness {
	readonly kind: "managed-cloud-postgresql-readiness";
	readonly manifestFingerprint: string;
	readonly state: "ready" | "stale" | "unavailable";
	readonly observedAtMs: number;
	readonly expiresAtMs: number;
	readonly deploymentProfile: ManagedCloudPostgresqlDeploymentProfile;
	readonly controlStoreReachable: boolean;
	readonly schemaVerified: boolean;
	readonly transportReady: boolean;
	readonly workerPoolReady: boolean;
	readonly quotaReady: boolean;
	readonly artifactResolverReady: boolean;
	readonly credentialResolverReady: boolean;
	readonly attestationRefs: readonly SourceRef[];
}

export interface ManagedCloudPostgresqlCoordinates {
	readonly runId: string;
	readonly attempt: number;
	readonly environmentRevision: string;
	readonly manifestFingerprint: string;
}

export interface ManagedCloudPostgresqlLeaseCoordinates extends ManagedCloudPostgresqlCoordinates {
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly workerId: string;
	readonly sessionEpoch: string;
	readonly deploymentRevision: string;
	readonly workerRevision: string;
}

export interface ManagedCloudPostgresqlAdmittedEnvelope extends ManagedCloudPostgresqlCoordinates {
	readonly kind: "managed-cloud-postgresql-admitted-envelope";
	readonly protocolRevision: typeof MANAGED_CLOUD_POSTGRESQL_PROTOCOL;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly adapterInputId: string;
	readonly principalId: string;
	readonly principalSessionRevision: string;
	readonly tenantId: string;
	readonly workspaceId: string;
	readonly resourceKind: string;
	readonly resourceId: string;
	readonly resourceRevision: string;
	readonly policyRevision: string;
	readonly modelRevision: string;
	readonly admissionId: string;
	readonly admissionProposalId: string;
	readonly admissionDecisionId?: string;
	readonly credentialBindingRevision: string;
	readonly deploymentRevision: string;
	readonly workerRevision: string;
	readonly workload: PostgresqlQueryToolArguments;
	readonly sourceRefs: readonly SourceRef[];
}

export type ManagedCloudPostgresqlWorkerMessage =
	| {
			readonly kind: "claim";
			readonly messageId: string;
			readonly protocolRevision: typeof MANAGED_CLOUD_POSTGRESQL_PROTOCOL;
			readonly workerId: string;
			readonly sessionEpoch: string;
			readonly environmentRevision: string;
			readonly deploymentRevision: string;
			readonly workerRevision: string;
			readonly authAttestationRef: SourceRef;
	  }
	| ({
			readonly kind: "heartbeat";
			readonly messageId: string;
	  } & ManagedCloudPostgresqlLeaseCoordinates)
	| ({
			readonly kind: "cancel-ack";
			readonly messageId: string;
			readonly cancellationId: string;
	  } & ManagedCloudPostgresqlLeaseCoordinates)
	| ({
			readonly kind: "credential-lifecycle";
			readonly messageId: string;
			readonly credentialBindingRevision: string;
			readonly state: ManagedCloudPostgresqlCredentialLifecycleState;
			readonly occurredAtMs: number;
			readonly expiresAtMs?: number;
			readonly evidenceRefs: readonly SourceRef[];
			readonly issueRefs: readonly SourceRef[];
	  } & ManagedCloudPostgresqlLeaseCoordinates)
	| ({
			readonly kind: "settle";
			readonly messageId: string;
			readonly settlementId: string;
			readonly outcome: "succeeded" | "failed" | "canceled";
			readonly outcomeRefs: readonly SourceRef[];
			readonly issueRefs: readonly SourceRef[];
			readonly credentialLifecycle?: readonly ManagedCloudPostgresqlCredentialLifecycleFact[];
	  } & ManagedCloudPostgresqlLeaseCoordinates);

export type ManagedCloudPostgresqlControlMessage =
	| ({
			readonly kind: "claim-granted";
			readonly messageId: string;
			readonly envelope: ManagedCloudPostgresqlAdmittedEnvelope;
			readonly leaseExpiresAtMs: number;
			readonly heartbeatExpiresAtMs: number;
	  } & ManagedCloudPostgresqlLeaseCoordinates)
	| ({
			readonly kind: "cancel";
			readonly messageId: string;
			readonly cancellationId: string;
	  } & ManagedCloudPostgresqlLeaseCoordinates)
	| ({
			readonly kind: "accepted";
			readonly messageId: string;
			readonly operation: "heartbeat" | "credential-lifecycle" | "cancel-ack" | "settle";
	  } & ManagedCloudPostgresqlLeaseCoordinates)
	| { readonly kind: "rejected"; readonly messageId: string; readonly code: string };

export type ManagedCloudPostgresqlLifecycleState =
	| "queued"
	| "claimed"
	| "heartbeat-current"
	| "cancel-pending"
	| "cancel-acknowledged"
	| "settled"
	| "expired"
	| "lost"
	| "rejected";

export interface ManagedCloudPostgresqlLifecycleFact {
	readonly kind: "managed-cloud-postgresql-lifecycle-fact";
	readonly state: ManagedCloudPostgresqlLifecycleState;
	readonly runId?: string;
	readonly attempt?: number;
	readonly leaseId?: string;
	readonly fencingToken?: number;
	readonly workerId?: string;
	readonly sessionEpoch?: string;
	readonly environmentRevision?: string;
	readonly manifestFingerprint?: string;
	readonly deploymentRevision?: string;
	readonly workerRevision?: string;
	readonly occurredAtMs: number;
	readonly code?: string;
}

export type ManagedCloudPostgresqlCredentialLifecycleState =
	| "issue-requested"
	| "issued"
	| "injected"
	| "revoking"
	| "revoked"
	| "cleanup-unverifiable"
	| "unavailable";

export interface ManagedCloudPostgresqlCredentialLifecycleFact
	extends ManagedCloudPostgresqlLeaseCoordinates {
	readonly kind: "managed-cloud-postgresql-credential-lifecycle-fact";
	readonly state: ManagedCloudPostgresqlCredentialLifecycleState;
	readonly credentialBindingRevision: string;
	readonly occurredAtMs: number;
	/** Host-enforced effective-use cutoff; for active facts this equals the admitted lease deadline. */
	readonly expiresAtMs?: number;
	readonly evidenceRefs: readonly SourceRef[];
	readonly issueRefs: readonly SourceRef[];
}

export interface ManagedCloudPostgresqlCancellationRequested
	extends ManagedCloudPostgresqlLeaseCoordinates {
	readonly kind: "managed-cloud-postgresql-cancellation-requested";
	readonly cancellationId: string;
}

export interface ManagedCloudPostgresqlCancellationPosture {
	readonly kind: "managed-cloud-postgresql-cancellation-posture";
	readonly cancellationId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly state: "persisted-pending" | "dispatched-unconfirmed" | "acknowledged" | "rejected";
	readonly code?: string;
}

export interface ManagedCloudPostgresqlStoreResult {
	readonly accepted: boolean;
	readonly code: string;
	readonly lifecycle?: ManagedCloudPostgresqlLifecycleFact;
	readonly lease?: ManagedCloudPostgresqlLeaseCoordinates & {
		readonly envelope: ManagedCloudPostgresqlAdmittedEnvelope;
		readonly leaseExpiresAtMs: number;
		readonly heartbeatExpiresAtMs: number;
	};
	readonly outcome?: ExecutorOutcome;
}

export type ManagedCloudPostgresqlAuthorizationRecheckStage = "claim" | "credential-issuance";

export type ManagedCloudPostgresqlAuthorizationRecheckState =
	| "allowed"
	| "denied"
	| "unavailable"
	| "revoked"
	| "expired";

export interface ManagedCloudPostgresqlAuthorizationRecheckResult
	extends ManagedCloudPostgresqlLeaseCoordinates {
	readonly kind: "managed-cloud-postgresql-authorization-recheck-result";
	readonly stage: ManagedCloudPostgresqlAuthorizationRecheckStage;
	readonly state: ManagedCloudPostgresqlAuthorizationRecheckState;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly adapterInputId: string;
	readonly principalId: string;
	readonly principalSessionRevision: string;
	readonly tenantId: string;
	readonly workspaceId: string;
	readonly resourceKind: string;
	readonly resourceId: string;
	readonly resourceRevision: string;
	readonly policyRevision: string;
	readonly modelRevision: string;
	readonly admissionId: string;
	readonly admissionProposalId: string;
	readonly admissionDecisionId?: string;
	readonly decisionRef: string;
	readonly authorizationRevisionRef?: string;
	readonly authorizationExpiresAtMs?: number;
	readonly grantGeneration: number;
	readonly grantHighWater: number;
	readonly observedAtMs: number;
	readonly issueRefs: readonly SourceRef[];
	readonly auditRefs: readonly SourceRef[];
	readonly credentialBindingRevision?: string;
}

export interface ManagedCloudPostgresqlClaimAuthorizationRequest {
	readonly kind: "managed-cloud-postgresql-claim-authorization-request";
	readonly message: Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "claim" }>;
	readonly lease: NonNullable<ManagedCloudPostgresqlStoreResult["lease"]>;
	readonly manifest: ManagedCloudPostgresqlManifest;
	readonly nowMs: number;
}

export interface ManagedCloudPostgresqlAuthorizationRecheckDriver {
	readonly compatibility: typeof MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY;
	authorizeClaim(
		request: ManagedCloudPostgresqlClaimAuthorizationRequest,
	): PromiseLike<ManagedCloudPostgresqlAuthorizationRecheckResult>;
	authorizeCredentialIssuance(
		context: ManagedCloudPostgresqlCredentialAuthorizationContext,
	): PromiseLike<ManagedCloudPostgresqlAuthorizationRecheckResult>;
}

/** Runtime-private atomic PostgreSQL control-store seam. Implementations must transact each call. */
export interface ManagedCloudPostgresqlControlStoreDriver {
	readonly compatibility: typeof MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE;
	readonly schemaRevision: typeof MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION;
	admit(
		envelope: ManagedCloudPostgresqlAdmittedEnvelope,
		nowMs: number,
	): PromiseLike<ManagedCloudPostgresqlStoreResult>;
	claim(
		input: Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "claim" }>,
		manifest: ManagedCloudPostgresqlManifest,
		nowMs: number,
	): PromiseLike<ManagedCloudPostgresqlStoreResult>;
	rejectClaim?(
		lease: NonNullable<ManagedCloudPostgresqlStoreResult["lease"]>,
		code: string,
		nowMs: number,
	): PromiseLike<ManagedCloudPostgresqlStoreResult>;
	heartbeat(
		input: Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "heartbeat" }>,
		expiresAtMs: number,
		nowMs: number,
	): PromiseLike<ManagedCloudPostgresqlStoreResult>;
	persistCancellation(
		input: ManagedCloudPostgresqlCancellationRequested,
		nowMs: number,
	): PromiseLike<ManagedCloudPostgresqlStoreResult>;
	acknowledgeCancellation(
		input: Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "cancel-ack" }>,
		nowMs: number,
	): PromiseLike<ManagedCloudPostgresqlStoreResult>;
	settle(
		input: Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "settle" }>,
		nowMs: number,
	): PromiseLike<ManagedCloudPostgresqlStoreResult>;
	expire(nowMs: number): PromiseLike<readonly ManagedCloudPostgresqlLifecycleFact[]>;
	disconnect(
		workerId: string,
		sessionEpoch: string,
		nowMs: number,
	): PromiseLike<readonly ManagedCloudPostgresqlLifecycleFact[]>;
	close(): void | PromiseLike<void>;
}

/** Runtime-private worker-initiated WSS transport seam. Socket/auth handles never become DATA. */
export interface ManagedCloudPostgresqlTransportDriver {
	readonly protocolRevision: typeof MANAGED_CLOUD_POSTGRESQL_PROTOCOL;
	start(
		onMessage: (message: unknown) => void,
		onDisconnect: (workerId: string, sessionEpoch: string) => void,
	): void | PromiseLike<void>;
	send(
		workerId: string,
		sessionEpoch: string,
		message: ManagedCloudPostgresqlControlMessage,
	): void | PromiseLike<void>;
	close(): void | PromiseLike<void>;
}

export interface ManagedCloudPostgresqlSqlClient {
	transaction<T>(
		work: (tx: {
			query<R extends Record<string, unknown>>(
				sql: string,
				values: readonly unknown[],
			): PromiseLike<{ rows: readonly R[] }>;
		}) => PromiseLike<T>,
	): PromiseLike<T>;
	close(): void | PromiseLike<void>;
}

const CONTROL_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS graphrefly_managed_cloud_v2 (admission_seq bigserial UNIQUE NOT NULL, run_id text NOT NULL, attempt integer NOT NULL, state text NOT NULL, envelope jsonb NOT NULL CHECK (envelope->>'protocolRevision' = 'graphrefly-managed-cloud-wss-json-v2'), lease_id text, fencing_token bigint NOT NULL DEFAULT 0, worker_id text, session_epoch text, deployment_revision text NOT NULL, worker_revision text NOT NULL, lease_expires_at_ms bigint, heartbeat_expires_at_ms bigint, cancellation jsonb, outcome jsonb, PRIMARY KEY (run_id, attempt))`;

/** Concrete PostgreSQL-16 adapter: every lifecycle mutation is one parameterized transaction/CAS. */
export function postgresql16ManagedCloudControlStore(
	client: ManagedCloudPostgresqlSqlClient,
): ManagedCloudPostgresqlControlStoreDriver & { install(): Promise<void> } {
	const one = async (sql: string, values: readonly unknown[]) => {
		assertSqlBindings(sql, values);
		return client.transaction(
			async (tx) =>
				(await tx.query<{ result: ManagedCloudPostgresqlStoreResult }>(sql, values)).rows[0]
					?.result ?? { accepted: false, code: "control-store-no-row" },
		);
	};
	const lifecycleRows = async (sql: string, values: readonly unknown[]) => {
		assertSqlBindings(sql, values);
		return client.transaction(async (tx) =>
			(await tx.query<{ lifecycle: ManagedCloudPostgresqlLifecycleFact }>(sql, values)).rows.map(
				(row) => snapshotLifecycle(row.lifecycle),
			),
		);
	};
	return {
		compatibility: MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE,
		schemaRevision: MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION,
		async install() {
			await client.transaction(async (tx) => {
				await tx.query(CONTROL_SCHEMA_SQL, []);
			});
		},
		admit(envelope, _nowMs) {
			return one(
				`INSERT INTO graphrefly_managed_cloud_v2 (run_id,attempt,state,envelope,deployment_revision,worker_revision) VALUES ($1,$2,'queued',$3::jsonb,$4,$5) ON CONFLICT DO NOTHING RETURNING jsonb_build_object('accepted',true,'code','admitted') AS result`,
				[
					envelope.runId,
					envelope.attempt,
					JSON.stringify(envelope),
					envelope.deploymentRevision,
					envelope.workerRevision,
				],
			);
		},
		async claim(input, manifest, nowMs) {
			const result = await one(
				`WITH candidate AS (SELECT run_id,attempt FROM graphrefly_managed_cloud_v2 WHERE state='queued' AND envelope->>'protocolRevision'='graphrefly-managed-cloud-wss-json-v2' AND deployment_revision=$6 AND worker_revision=$7 AND envelope->>'environmentRevision'=$8 AND envelope->>'manifestFingerprint'=$9 ORDER BY admission_seq FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE graphrefly_managed_cloud_v2 q SET state='claimed', lease_id=$1, fencing_token=q.fencing_token+1, worker_id=$2, session_epoch=$3, lease_expires_at_ms=$4, heartbeat_expires_at_ms=$5 FROM candidate c WHERE q.run_id=c.run_id AND q.attempt=c.attempt RETURNING jsonb_build_object('accepted',true,'code','claimed','lease',jsonb_build_object('runId',q.run_id,'attempt',q.attempt,'environmentRevision',$8,'manifestFingerprint',$9,'leaseId',q.lease_id,'fencingToken',q.fencing_token,'workerId',q.worker_id,'sessionEpoch',q.session_epoch,'deploymentRevision',q.deployment_revision,'workerRevision',q.worker_revision,'envelope',q.envelope,'leaseExpiresAtMs',q.lease_expires_at_ms,'heartbeatExpiresAtMs',q.heartbeat_expires_at_ms),'lifecycle',jsonb_build_object('kind','managed-cloud-postgresql-lifecycle-fact','state','claimed','runId',q.run_id,'attempt',q.attempt,'leaseId',q.lease_id,'fencingToken',q.fencing_token,'workerId',q.worker_id,'sessionEpoch',q.session_epoch,'environmentRevision',$8,'manifestFingerprint',$9,'deploymentRevision',q.deployment_revision,'workerRevision',q.worker_revision,'occurredAtMs',$4)) AS result`,
				[
					`lease:${input.messageId}`,
					input.workerId,
					input.sessionEpoch,
					nowMs + manifest.leaseDurationMs,
					nowMs + manifest.heartbeatDurationMs,
					input.deploymentRevision,
					input.workerRevision,
					input.environmentRevision,
					manifest.fingerprint,
				],
			);
			return result.accepted && result.lease !== undefined
				? { ...result, lifecycle: leaseLifecycle("claimed", result.lease, nowMs) }
				: result;
		},
		async rejectClaim(lease, code, nowMs) {
			const result = await one(
				`UPDATE graphrefly_managed_cloud_v2 SET state='rejected', fencing_token=fencing_token+1 WHERE run_id=$1 AND attempt=$2 AND lease_id=$3 AND fencing_token=$4 AND worker_id=$5 AND session_epoch=$6 AND deployment_revision=$7 AND worker_revision=$8 AND state='claimed' AND envelope->>'environmentRevision'=$9 AND envelope->>'manifestFingerprint'=$10 RETURNING jsonb_build_object('accepted',true,'code',$11,'lifecycle',jsonb_build_object('kind','managed-cloud-postgresql-lifecycle-fact','state','rejected','runId',run_id,'attempt',attempt,'leaseId',lease_id,'fencingToken',fencing_token,'workerId',worker_id,'sessionEpoch',session_epoch,'environmentRevision',envelope->>'environmentRevision','manifestFingerprint',envelope->>'manifestFingerprint','deploymentRevision',deployment_revision,'workerRevision',worker_revision,'occurredAtMs',$12,'code',$11)) AS result`,
				[
					lease.runId,
					lease.attempt,
					lease.leaseId,
					lease.fencingToken,
					lease.workerId,
					lease.sessionEpoch,
					lease.deploymentRevision,
					lease.workerRevision,
					lease.environmentRevision,
					lease.manifestFingerprint,
					code,
					nowMs,
				],
			);
			return result.accepted
				? {
						...result,
						lifecycle: result.lifecycle ?? { ...leaseLifecycle("rejected", lease, nowMs), code },
					}
				: result;
		},
		async heartbeat(input, expiresAtMs, nowMs) {
			const result = await one(
				`UPDATE graphrefly_managed_cloud_v2 SET heartbeat_expires_at_ms=$1, lease_expires_at_ms=GREATEST(lease_expires_at_ms,$1) WHERE run_id=$2 AND attempt=$3 AND lease_id=$4 AND fencing_token=$5 AND worker_id=$6 AND session_epoch=$7 AND deployment_revision=$8 AND worker_revision=$9 AND state='claimed' AND lease_expires_at_ms>$10 AND envelope->>'environmentRevision'=$11 AND envelope->>'manifestFingerprint'=$12 RETURNING jsonb_build_object('accepted',true,'code','renewed') AS result`,
				[
					expiresAtMs,
					input.runId,
					input.attempt,
					input.leaseId,
					input.fencingToken,
					input.workerId,
					input.sessionEpoch,
					input.deploymentRevision,
					input.workerRevision,
					nowMs,
					input.environmentRevision,
					input.manifestFingerprint,
				],
			);
			return result.accepted
				? { ...result, lifecycle: leaseLifecycle("heartbeat-current", input, nowMs) }
				: result;
		},
		async persistCancellation(input, nowMs) {
			const result = await one(
				`UPDATE graphrefly_managed_cloud_v2 SET cancellation=$1::jsonb WHERE run_id=$2 AND attempt=$3 AND lease_id=$4 AND fencing_token=$5 AND session_epoch=$6 AND deployment_revision=$7 AND worker_revision=$8 AND state='claimed' AND lease_expires_at_ms>$9 AND envelope->>'environmentRevision'=$10 AND envelope->>'manifestFingerprint'=$11 AND worker_id=$12 RETURNING jsonb_build_object('accepted',true,'code','cancel-persisted') AS result`,
				[
					JSON.stringify(input),
					input.runId,
					input.attempt,
					input.leaseId,
					input.fencingToken,
					input.sessionEpoch,
					input.deploymentRevision,
					input.workerRevision,
					nowMs,
					input.environmentRevision,
					input.manifestFingerprint,
					input.workerId,
				],
			);
			return result.accepted
				? { ...result, lifecycle: leaseLifecycle("cancel-pending", input, nowMs) }
				: result;
		},
		async acknowledgeCancellation(input, nowMs) {
			const result = await one(
				`UPDATE graphrefly_managed_cloud_v2 SET cancellation=cancellation||'{"acknowledged":true}'::jsonb WHERE run_id=$1 AND attempt=$2 AND lease_id=$3 AND fencing_token=$4 AND session_epoch=$5 AND deployment_revision=$6 AND worker_revision=$7 AND cancellation->>'cancellationId'=$8 AND state='claimed' AND lease_expires_at_ms>$9 AND envelope->>'environmentRevision'=$10 AND envelope->>'manifestFingerprint'=$11 AND worker_id=$12 RETURNING jsonb_build_object('accepted',true,'code','cancel-ack') AS result`,
				[
					input.runId,
					input.attempt,
					input.leaseId,
					input.fencingToken,
					input.sessionEpoch,
					input.deploymentRevision,
					input.workerRevision,
					input.cancellationId,
					nowMs,
					input.environmentRevision,
					input.manifestFingerprint,
					input.workerId,
				],
			);
			return result.accepted
				? { ...result, lifecycle: leaseLifecycle("cancel-acknowledged", input, nowMs) }
				: result;
		},
		async settle(input, nowMs) {
			const result = await one(
				`UPDATE graphrefly_managed_cloud_v2 SET state='settled', outcome=jsonb_build_object('kind',CASE $1 WHEN 'succeeded' THEN 'result' WHEN 'failed' THEN 'failure' ELSE 'canceled' END,'outcomeId',$2,'requestId',envelope->>'requestId','operationId',envelope->>'operationId','routeId',envelope->>'routeId','executorId',envelope->>'executorId','profileId',envelope->>'profileId','attempt',attempt,'inputId',envelope->>'adapterInputId','inputKind','tool-call','metadata',jsonb_build_object('runId',run_id,'sessionEpoch',session_epoch,'fencingToken',fencing_token)) || CASE $1 WHEN 'succeeded' THEN jsonb_build_object('result',jsonb_build_object('kind','managed-cloud-result-refs','value',jsonb_build_object('outcomeRefs',$3::jsonb))) WHEN 'failed' THEN jsonb_build_object('error',jsonb_build_object('kind','issue','code','managed-cloud-worker-failure','message','Managed-cloud worker reported failure.','severity','error'),'retryable',false) ELSE jsonb_build_object('reason','admitted-managed-cloud-cancellation') END WHERE run_id=$4 AND attempt=$5 AND lease_id=$6 AND fencing_token=$7 AND session_epoch=$8 AND deployment_revision=$9 AND worker_revision=$10 AND state='claimed' AND lease_expires_at_ms>$11 AND envelope->>'environmentRevision'=$12 AND envelope->>'manifestFingerprint'=$13 AND worker_id=$14 RETURNING jsonb_build_object('accepted',true,'code','settled','outcome',outcome) AS result`,
				[
					input.outcome,
					input.settlementId,
					JSON.stringify(input.outcomeRefs),
					input.runId,
					input.attempt,
					input.leaseId,
					input.fencingToken,
					input.sessionEpoch,
					input.deploymentRevision,
					input.workerRevision,
					nowMs,
					input.environmentRevision,
					input.manifestFingerprint,
					input.workerId,
				],
			);
			return result.accepted
				? {
						...result,
						...(result.outcome === undefined
							? {}
							: { outcome: settlementEvidence(result.outcome, input) }),
						lifecycle: leaseLifecycle("settled", input, nowMs),
					}
				: result;
		},
		async expire(nowMs) {
			return lifecycleRows(
				`UPDATE graphrefly_managed_cloud_v2 SET state='expired', fencing_token=fencing_token+1 WHERE state='claimed' AND lease_expires_at_ms <= $1 RETURNING jsonb_build_object('kind','managed-cloud-postgresql-lifecycle-fact','state','expired','runId',run_id,'attempt',attempt,'leaseId',lease_id,'fencingToken',fencing_token,'workerId',worker_id,'sessionEpoch',session_epoch,'environmentRevision',envelope->>'environmentRevision','manifestFingerprint',envelope->>'manifestFingerprint','deploymentRevision',deployment_revision,'workerRevision',worker_revision,'occurredAtMs',$1) AS lifecycle`,
				[nowMs],
			);
		},
		async disconnect(workerId, sessionEpoch, nowMs) {
			return lifecycleRows(
				`UPDATE graphrefly_managed_cloud_v2 SET state='lost', fencing_token=fencing_token+1 WHERE worker_id=$1 AND session_epoch=$2 AND state='claimed' AND lease_expires_at_ms>$3 RETURNING jsonb_build_object('kind','managed-cloud-postgresql-lifecycle-fact','state','lost','runId',run_id,'attempt',attempt,'leaseId',lease_id,'fencingToken',fencing_token,'workerId',worker_id,'sessionEpoch',session_epoch,'environmentRevision',envelope->>'environmentRevision','manifestFingerprint',envelope->>'manifestFingerprint','deploymentRevision',deployment_revision,'workerRevision',worker_revision,'occurredAtMs',$3) AS lifecycle`,
				[workerId, sessionEpoch, nowMs],
			);
		},
		close() {
			return client.close();
		},
	};
}

export interface ManagedCloudPostgresqlWssSocket {
	readonly workerId: string;
	readonly sessionEpoch: string;
	readonly deploymentRevision: string;
	readonly workerRevision: string;
	readonly authAttestationRef: SourceRef;
	send(text: string): void | PromiseLike<void>;
	close(): void | PromiseLike<void>;
}
export interface ManagedCloudPostgresqlWssFactory {
	listen(
		accept: (socket: ManagedCloudPostgresqlWssSocket, text: string) => void,
		disconnect: (socket: ManagedCloudPostgresqlWssSocket) => void,
	): void | PromiseLike<() => void | PromiseLike<void>>;
}
export interface ManagedCloudPostgresqlWssVerifier {
	verify(socket: ManagedCloudPostgresqlWssSocket): boolean | PromiseLike<boolean>;
}

/** Concrete authenticated worker-initiated WSS JSON adapter with per-epoch duplicate suppression. */
export function authenticatedWssManagedCloudTransport(
	factory: ManagedCloudPostgresqlWssFactory,
	verifier: ManagedCloudPostgresqlWssVerifier,
): ManagedCloudPostgresqlTransportDriver {
	const sockets = new Map<string, ManagedCloudPostgresqlWssSocket>();
	const seen = new Map<string, Set<string>>();
	const disconnected = new Set<string>();
	let stop: (() => void | PromiseLike<void>) | undefined;
	return {
		protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
		async start(onMessage, onDisconnect) {
			const disconnectOnce = (socket: ManagedCloudPostgresqlWssSocket) => {
				const key = `${socket.workerId}:${socket.sessionEpoch}`;
				if (disconnected.has(key)) return;
				disconnected.add(key);
				onDisconnect(socket.workerId, socket.sessionEpoch);
			};
			const listener = await factory.listen(
				async (socket, text) => {
					const key = `${socket.workerId}:${socket.sessionEpoch}`;
					if (disconnected.has(key)) {
						await socket.close();
						return;
					}
					if (!(await verifier.verify(socket))) {
						await socket.close();
						return;
					}
					const existing = sockets.get(key);
					if (existing !== undefined && existing !== socket) {
						await socket.close();
						return;
					}
					sockets.set(key, socket);
					let raw: unknown;
					try {
						raw = JSON.parse(text);
					} catch {
						return;
					}
					if (!isRecord(raw) || typeof raw.messageId !== "string") return;
					const ids = seen.get(key) ?? new Set<string>();
					if (ids.has(raw.messageId)) return;
					if (ids.size >= 1024) {
						sockets.delete(key);
						seen.delete(key);
						try {
							await socket.close();
						} finally {
							disconnectOnce(socket);
						}
						return;
					}
					ids.add(raw.messageId);
					seen.set(key, ids);
					onMessage({
						...raw,
						workerId: socket.workerId,
						sessionEpoch: socket.sessionEpoch,
						deploymentRevision: socket.deploymentRevision,
						workerRevision: socket.workerRevision,
						...(raw.kind === "claim" ? { authAttestationRef: socket.authAttestationRef } : {}),
					});
				},
				(socket) => {
					const key = `${socket.workerId}:${socket.sessionEpoch}`;
					if (sockets.get(key) !== socket) return;
					sockets.delete(key);
					seen.delete(key);
					disconnectOnce(socket);
				},
			);
			stop = typeof listener === "function" ? listener : undefined;
		},
		async send(workerId, sessionEpoch, message) {
			const socket = sockets.get(`${workerId}:${sessionEpoch}`);
			if (socket === undefined) throw new TypeError("No authenticated current WSS session.");
			await socket.send(JSON.stringify(message));
		},
		async close() {
			const closing = [...sockets.values()];
			sockets.clear();
			seen.clear();
			disconnected.clear();
			await Promise.allSettled(closing.map((socket) => Promise.resolve(socket.close())));
			await stop?.();
		},
	};
}

/** Runtime-private managed worker execution seam; credentials and PostgreSQL clients stay private. */
export interface ManagedCloudPostgresqlWorkerDriver {
	readonly compatibility: typeof MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY;
	execute(
		workload: PostgresqlQueryToolArguments,
		context: ManagedCloudPostgresqlLeaseCoordinates & {
			readonly credentialBindingRevision: string;
			readonly signal: AbortSignal;
		},
	): PromiseLike<{
		readonly outcome: "succeeded" | "failed";
		readonly outcomeRefs: readonly SourceRef[];
		readonly issueRefs?: readonly SourceRef[];
	}>;
}

export interface ManagedCloudPostgresqlCredentialAuthorizationContext
	extends ManagedCloudPostgresqlLeaseCoordinates {
	readonly credentialBindingRevision: string;
	readonly leaseExpiresAtMs: number;
	readonly heartbeatExpiresAtMs: number;
	readonly envelope: ManagedCloudPostgresqlAdmittedEnvelope;
	readonly signal: AbortSignal;
}

export interface ManagedCloudPostgresqlAttemptCredentialContext
	extends ManagedCloudPostgresqlCredentialAuthorizationContext {
	readonly authorization: ManagedCloudPostgresqlAuthorizationRecheckResult;
}

export interface ManagedCloudPostgresqlAttemptCredentialPreparation {
	readonly ready: boolean;
	readonly lifecycle: readonly ManagedCloudPostgresqlCredentialLifecycleFact[];
	readonly issueRefs?: readonly SourceRef[];
}

export interface ManagedCloudPostgresqlAttemptCredentialCleanup {
	/** Full terminal lifecycle sequence, including the preparation prefix. */
	readonly lifecycle: readonly ManagedCloudPostgresqlCredentialLifecycleFact[];
	readonly issueRefs?: readonly SourceRef[];
}

export interface ManagedCloudPostgresqlAttemptCredentialDriver {
	readonly compatibility: typeof MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY;
	prepareAttemptCredential(
		context: ManagedCloudPostgresqlAttemptCredentialContext,
	): PromiseLike<ManagedCloudPostgresqlAttemptCredentialPreparation>;
	cleanupAttemptCredential(
		context: ManagedCloudPostgresqlAttemptCredentialContext,
	): PromiseLike<ManagedCloudPostgresqlAttemptCredentialCleanup>;
}

/**
 * Execute one store-issued fenced claim and derive, rather than accept, its settlement envelope.
 *
 * This low-level helper preserves same-wave compatibility for existing host cooperation tests.
 * D611 production worker compositions should use
 * `executeManagedCloudPostgresqlClaimWithAttemptCredential` so a host-private attempt credential
 * lifecycle driver is mandatory and the workload cannot run through the bare driver path.
 */
async function executeManagedCloudPostgresqlClaim(
	claim: Extract<ManagedCloudPostgresqlControlMessage, { kind: "claim-granted" }>,
	driver: ManagedCloudPostgresqlWorkerDriver,
	settlementId: string,
	messageId: string,
	signal: AbortSignal,
	now: () => number,
	credentialDriver?: ManagedCloudPostgresqlAttemptCredentialDriver,
	authorizationDriver?: Pick<
		ManagedCloudPostgresqlAuthorizationRecheckDriver,
		"compatibility" | "authorizeCredentialIssuance"
	>,
): Promise<Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "settle" }>> {
	if (driver.compatibility !== MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY)
		throw new TypeError("Managed-cloud worker compatibility mismatch.");
	if (
		credentialDriver !== undefined &&
		credentialDriver.compatibility !== MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY
	)
		throw new TypeError("Managed-cloud credential lifecycle compatibility mismatch.");
	if (
		authorizationDriver !== undefined &&
		authorizationDriver.compatibility !== MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY
	)
		throw new TypeError("Managed-cloud authorization recheck compatibility mismatch.");
	assertSafe(settlementId, "settlementId");
	assertSafe(messageId, "messageId");
	if (typeof now !== "function") throw new TypeError("Managed-cloud authority clock is required.");
	for (const value of [
		claim.runId,
		claim.environmentRevision,
		claim.manifestFingerprint,
		claim.leaseId,
		claim.workerId,
		claim.sessionEpoch,
		claim.deploymentRevision,
		claim.workerRevision,
	])
		assertSafe(value, "worker claim coordinate");
	if (
		!positive(claim.attempt) ||
		!positive(claim.fencingToken) ||
		claim.envelope.runId !== claim.runId ||
		claim.envelope.attempt !== claim.attempt ||
		claim.envelope.environmentRevision !== claim.environmentRevision ||
		claim.envelope.manifestFingerprint !== claim.manifestFingerprint ||
		claim.envelope.deploymentRevision !== claim.deploymentRevision ||
		claim.envelope.workerRevision !== claim.workerRevision ||
		claim.envelope.protocolRevision !== MANAGED_CLOUD_POSTGRESQL_PROTOCOL
	)
		throw new TypeError("Invalid managed-cloud worker claim.");
	const envelope = snapshotAdmittedEnvelope(claim.envelope);
	const workload = envelope.workload;
	const authorizationContext: ManagedCloudPostgresqlCredentialAuthorizationContext = {
		...leaseCoordinates(claim),
		credentialBindingRevision: envelope.credentialBindingRevision,
		leaseExpiresAtMs: claim.leaseExpiresAtMs,
		heartbeatExpiresAtMs: claim.heartbeatExpiresAtMs,
		envelope,
		signal,
	};
	let authorization: ManagedCloudPostgresqlAuthorizationRecheckResult | undefined;
	let authorizationValidatedAtMs: number | undefined;
	if (authorizationDriver !== undefined) {
		const authorizationRequestedAtMs = authorityNow(now);
		const verifiedAuthorization =
			(await attemptAuthorizationRecheck(
				authorizationDriver,
				authorizationContext,
				"credential-issuance",
			)) ?? authorizationUnavailableForClaim(claim, "credential-issuance");
		authorizationValidatedAtMs = authorityNow(now);
		const correlated =
			authorizationMatchesLease(verifiedAuthorization, claim, envelope) &&
			verifiedAuthorization.credentialBindingRevision === envelope.credentialBindingRevision;
		if (
			!correlated ||
			!authorizationAllowsAttempt(
				verifiedAuthorization,
				claim.leaseExpiresAtMs,
				authorizationRequestedAtMs,
				authorizationValidatedAtMs,
			)
		) {
			const failureAuthorization = correlated
				? verifiedAuthorization
				: authorizationUnavailableForClaim(claim, "credential-issuance");
			return Object.freeze({
				kind: "settle",
				messageId,
				settlementId,
				outcome: "failed",
				outcomeRefs: [],
				issueRefs: authorizationIssueRefs(failureAuthorization),
				credentialLifecycle: authorizationCredentialUnavailableLifecycle(
					claim,
					failureAuthorization,
				),
				...leaseCoordinates(claim),
			});
		}
		authorization = verifiedAuthorization;
	}
	if (credentialDriver !== undefined && authorization === undefined) {
		throw new TypeError(
			"Managed-cloud attempt credential execution requires authorization evidence.",
		);
	}
	const context: ManagedCloudPostgresqlAttemptCredentialContext | undefined =
		authorization === undefined ? undefined : { ...authorizationContext, authorization };
	if (credentialDriver === undefined) {
		const result = await driver.execute(workload, authorizationContext);
		if (result === undefined) throw new TypeError("Managed-cloud worker returned no result.");
		return Object.freeze({
			kind: "settle",
			messageId,
			settlementId,
			outcome: result.outcome,
			outcomeRefs: refs(result.outcomeRefs),
			issueRefs: refs(result.issueRefs ?? []),
			...leaseCoordinates(claim),
		});
	}
	let preparation: ManagedCloudPostgresqlAttemptCredentialPreparation;
	let preparedLifecycle: readonly ManagedCloudPostgresqlCredentialLifecycleFact[];
	try {
		preparation = await credentialDriver.prepareAttemptCredential(context!);
		preparedLifecycle = snapshotCredentialLifecyclePreparation(
			preparation.lifecycle,
			claim,
			preparation.ready,
		);
	} catch {
		const cleanup = await terminalCredentialCleanup(
			credentialDriver,
			context!,
			claim,
			undefined,
			now,
		);
		return failedCredentialSettlement(claim, settlementId, messageId, cleanup.lifecycle, [
			{ kind: "issue", id: "credential-preparation-unverifiable" },
		]);
	}
	if (!preparation.ready)
		return failedCredentialSettlement(
			claim,
			settlementId,
			messageId,
			preparedLifecycle,
			credentialRefs(preparation.issueRefs ?? credentialLifecycleIssueRefs(preparedLifecycle)),
		);
	const beforeWorkloadAtMs = authorityNow(now);
	const authorityClockRegressed =
		authorizationValidatedAtMs !== undefined && beforeWorkloadAtMs < authorizationValidatedAtMs;
	if (
		authorizationValidatedAtMs === undefined ||
		authorityClockRegressed ||
		beforeWorkloadAtMs >= claim.leaseExpiresAtMs ||
		authorization!.authorizationExpiresAtMs === undefined ||
		beforeWorkloadAtMs >= authorization!.authorizationExpiresAtMs
	) {
		const cleanup = await terminalCredentialCleanup(
			credentialDriver,
			context!,
			claim,
			preparedLifecycle,
			now,
		);
		return failedCredentialSettlement(claim, settlementId, messageId, cleanup.lifecycle, [
			{
				kind: "issue",
				id: authorityClockRegressed
					? "authority-clock-regressed-before-workload"
					: "authorization-expired-before-workload",
			},
		]);
	}
	let result: Awaited<ReturnType<ManagedCloudPostgresqlWorkerDriver["execute"]>> | undefined;
	let executionError: unknown;
	try {
		result = await driver.execute(workload, authorizationContext);
	} catch (caught) {
		executionError = caught;
	}
	const cleanup = await terminalCredentialCleanup(
		credentialDriver,
		context!,
		claim,
		preparedLifecycle,
		now,
	);
	if (executionError !== undefined || result === undefined)
		return failedCredentialSettlement(claim, settlementId, messageId, cleanup.lifecycle, [
			{ kind: "issue", id: "managed-cloud-workload-execution-failed" },
			...cleanup.issueRefs,
		]);
	if (cleanup.issueRefs.length > 0)
		return failedCredentialSettlement(
			claim,
			settlementId,
			messageId,
			cleanup.lifecycle,
			cleanup.issueRefs,
		);
	return Object.freeze({
		kind: "settle",
		messageId,
		settlementId,
		outcome: result.outcome,
		outcomeRefs: refs(result.outcomeRefs),
		issueRefs: refs(result.issueRefs ?? cleanup.issueRefs),
		credentialLifecycle: cleanup.lifecycle,
		...leaseCoordinates(claim),
	});
}

/**
 * D611 managed-cloud worker entry for an admitted, fenced PostgreSQL claim.
 *
 * The attempt credential lifecycle driver is required here: callers cannot reach workload
 * execution through this entry without the host-private SPIRE/OpenBao-compatible issue/inject/
 * revoke seam. Concrete SPIRE/OpenBao clients, SVIDs, vault paths, secret leases, PostgreSQL
 * credentials, sockets, descriptors and handles remain outside Graph DATA and public DTOs.
 */
export async function executeManagedCloudPostgresqlClaimWithAttemptCredential(
	claim: Extract<ManagedCloudPostgresqlControlMessage, { kind: "claim-granted" }>,
	driver: ManagedCloudPostgresqlWorkerDriver,
	settlementId: string,
	messageId: string,
	signal: AbortSignal,
	now: () => number,
	credentialDriver: ManagedCloudPostgresqlAttemptCredentialDriver,
	authorizationDriver: Pick<
		ManagedCloudPostgresqlAuthorizationRecheckDriver,
		"compatibility" | "authorizeCredentialIssuance"
	>,
): Promise<Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "settle" }>> {
	if (credentialDriver === undefined || authorizationDriver === undefined)
		throw new TypeError(
			"Managed-cloud attempt credential lifecycle and authorization recheck drivers are required.",
		);
	return executeManagedCloudPostgresqlClaim(
		claim,
		driver,
		settlementId,
		messageId,
		signal,
		now,
		credentialDriver,
		authorizationDriver,
	);
}

/**
 * D618 managed-cloud worker entry: current authorization/revocation is checked
 * immediately before the host-private SPIRE/OpenBao attempt credential lifecycle.
 */
export async function executeManagedCloudPostgresqlClaimWithAuthorizedAttemptCredential(
	claim: Extract<ManagedCloudPostgresqlControlMessage, { kind: "claim-granted" }>,
	driver: ManagedCloudPostgresqlWorkerDriver,
	settlementId: string,
	messageId: string,
	signal: AbortSignal,
	now: () => number,
	credentialDriver: ManagedCloudPostgresqlAttemptCredentialDriver,
	authorizationDriver: Pick<
		ManagedCloudPostgresqlAuthorizationRecheckDriver,
		"compatibility" | "authorizeCredentialIssuance"
	>,
): Promise<Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "settle" }>> {
	if (credentialDriver === undefined || authorizationDriver === undefined)
		throw new TypeError(
			"Managed-cloud attempt credential lifecycle and authorization recheck drivers are required.",
		);
	return executeManagedCloudPostgresqlClaim(
		claim,
		driver,
		settlementId,
		messageId,
		signal,
		now,
		credentialDriver,
		authorizationDriver,
	);
}

export interface ManagedCloudPostgresqlRuntimeOptions {
	readonly name?: string;
	readonly admittedRunRequests: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly inputs: Node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>;
	readonly manifests: readonly Node<ManagedCloudPostgresqlManifest>[];
	readonly readiness: readonly Node<ManagedCloudPostgresqlReadiness>[];
	readonly cancellationRequests?: readonly Node<ManagedCloudPostgresqlCancellationRequested>[];
	readonly store: ManagedCloudPostgresqlControlStoreDriver;
	readonly transport: ManagedCloudPostgresqlTransportDriver;
	readonly authorizationRecheck: ManagedCloudPostgresqlAuthorizationRecheckDriver;
	readonly now?: () => number;
}

export interface ManagedCloudPostgresqlRuntimeBundle {
	readonly admittedEnvelopes: Node<ManagedCloudPostgresqlAdmittedEnvelope>;
	readonly lifecycle: Node<ManagedCloudPostgresqlLifecycleFact>;
	readonly credentialLifecycle: Node<ManagedCloudPostgresqlCredentialLifecycleFact>;
	readonly runStatus: Node<ToolProviderAdapterRunStatus>;
	readonly outcomes: Node<ExecutorOutcome>;
	readonly cancellations: Node<ManagedCloudPostgresqlCancellationPosture>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	expire(): Promise<void>;
	redeliverPendingCancellations(): Promise<void>;
	dispose(): Promise<void>;
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const MAX_REFS = 32;
const manifestKeys = new Set([
	"kind",
	"manifestId",
	"revision",
	"fingerprint",
	"compatibilityRevision",
	"controlStoreCompatibility",
	"controlStoreSchemaRevision",
	"workerProtocolRevision",
	"recipeRevision",
	"queuePolicyRevision",
	"leasePolicyRevision",
	"credentialBindingRevision",
	"deploymentRevision",
	"deploymentProfile",
	"workerRevision",
	"leaseDurationMs",
	"heartbeatDurationMs",
	"attestationRefs",
]);
const readinessKeys = new Set([
	"kind",
	"manifestFingerprint",
	"state",
	"observedAtMs",
	"expiresAtMs",
	"deploymentProfile",
	"controlStoreReachable",
	"schemaVerified",
	"transportReady",
	"workerPoolReady",
	"quotaReady",
	"artifactResolverReady",
	"credentialResolverReady",
	"attestationRefs",
]);
const managedCloudPostgresqlDeploymentProfiles = new Set<ManagedCloudPostgresqlDeploymentProfile>([
	MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE,
	"single-vm-development",
	"docker-compose-development",
	"unverifiable",
]);

function isManagedCloudPostgresqlDeploymentProfile(
	value: unknown,
): value is ManagedCloudPostgresqlDeploymentProfile {
	return (
		typeof value === "string" &&
		managedCloudPostgresqlDeploymentProfiles.has(value as ManagedCloudPostgresqlDeploymentProfile)
	);
}

export function managedCloudPostgresqlManifest(
	value: ManagedCloudPostgresqlManifest,
): ManagedCloudPostgresqlManifest {
	assertPlainRecord(value, "manifest");
	if (
		value.kind !== "managed-cloud-postgresql-manifest" ||
		!Object.keys(value).every((key) => manifestKeys.has(key))
	)
		throw new TypeError("Invalid or unsupported managed-cloud manifest material.");
	if (!isManagedCloudPostgresqlDeploymentProfile(value.deploymentProfile))
		throw new TypeError("Managed-cloud deployment profile is not recognized.");
	for (const item of [
		value.manifestId,
		value.revision,
		value.fingerprint,
		value.queuePolicyRevision,
		value.leasePolicyRevision,
		value.credentialBindingRevision,
		value.deploymentRevision,
		value.workerRevision,
	])
		assertSafe(item, "manifest coordinate");
	if (
		value.compatibilityRevision !== MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY ||
		value.controlStoreCompatibility !== MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE ||
		value.controlStoreSchemaRevision !== MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION ||
		value.workerProtocolRevision !== MANAGED_CLOUD_POSTGRESQL_PROTOCOL ||
		value.recipeRevision !== "postgresql-read-only-query-v1"
	)
		throw new TypeError("Managed-cloud compatibility revision mismatch.");
	for (const duration of [value.leaseDurationMs, value.heartbeatDurationMs])
		if (!Number.isSafeInteger(duration) || duration < 100 || duration > 3_600_000)
			throw new RangeError("Invalid managed-cloud duration.");
	if (value.heartbeatDurationMs > value.leaseDurationMs)
		throw new RangeError("Heartbeat duration cannot exceed lease duration.");
	return Object.freeze({ ...value, attestationRefs: refs(value.attestationRefs) });
}

export function managedCloudPostgresqlReadiness(
	value: ManagedCloudPostgresqlReadiness,
): ManagedCloudPostgresqlReadiness {
	assertPlainRecord(value, "readiness");
	if (
		value.kind !== "managed-cloud-postgresql-readiness" ||
		!Object.keys(value).every((key) => readinessKeys.has(key))
	)
		throw new TypeError("Invalid or unsupported managed-cloud readiness material.");
	assertSafe(value.manifestFingerprint, "manifest fingerprint");
	if (
		!["ready", "stale", "unavailable"].includes(value.state) ||
		!isManagedCloudPostgresqlDeploymentProfile(value.deploymentProfile) ||
		(value.state === "ready" &&
			value.deploymentProfile !== MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE) ||
		!Number.isSafeInteger(value.observedAtMs) ||
		!Number.isSafeInteger(value.expiresAtMs) ||
		value.expiresAtMs < value.observedAtMs
	)
		throw new TypeError("Invalid managed-cloud readiness posture.");
	return Object.freeze({ ...value, attestationRefs: refs(value.attestationRefs) });
}

export function managedCloudPostgresqlRuntime(
	graph: Graph,
	opts: ManagedCloudPostgresqlRuntimeOptions,
): ManagedCloudPostgresqlRuntimeBundle {
	if (
		opts.store.compatibility !== MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE ||
		opts.store.schemaRevision !== MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION
	)
		throw new TypeError("Managed-cloud control-store compatibility mismatch.");
	if (opts.transport.protocolRevision !== MANAGED_CLOUD_POSTGRESQL_PROTOCOL)
		throw new TypeError("Managed-cloud worker protocol mismatch.");
	if (opts.authorizationRecheck.compatibility !== MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY)
		throw new TypeError("Managed-cloud authorization recheck compatibility mismatch.");
	const now = opts.now ?? Date.now;
	const name = opts.name ?? "managedCloudPostgresql";
	const group = graph.topologyGroup({ name });
	const admittedEnvelopes = group.node<ManagedCloudPostgresqlAdmittedEnvelope>([], null, {
		name: `${name}/admittedEnvelopes`,
		factory: "managedCloudPostgresqlAdmittedEnvelopes",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const lifecycle = group.node<ManagedCloudPostgresqlLifecycleFact>([], null, {
		name: `${name}/lifecycle`,
		factory: "managedCloudPostgresqlLifecycle",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const credentialLifecycle = group.node<ManagedCloudPostgresqlCredentialLifecycleFact>([], null, {
		name: `${name}/credentialLifecycle`,
		factory: "managedCloudPostgresqlCredentialLifecycle",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const runStatus = group.node<ToolProviderAdapterRunStatus>([], null, {
		name: `${name}/runStatus`,
		factory: "managedCloudPostgresqlRunStatus",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const outcomes = group.node<ExecutorOutcome>([], null, {
		name: `${name}/outcomes`,
		factory: "managedCloudPostgresqlOutcomes",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const cancellations = group.node<ManagedCloudPostgresqlCancellationPosture>([], null, {
		name: `${name}/cancellations`,
		factory: "managedCloudPostgresqlCancellations",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const issues = group.node<DataIssue>([], null, {
		name: `${name}/issues`,
		factory: "managedCloudPostgresqlIssues",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const audit = group.node<AgentRuntimeAuditRecord>([], null, {
		name: `${name}/audit`,
		factory: "managedCloudPostgresqlAudit",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	let manifest: ManagedCloudPostgresqlManifest | undefined;
	let posture: ManagedCloudPostgresqlReadiness | undefined;
	const inputs = new Map<string, ToolProviderAdapterInput<PostgresqlQueryToolArguments>>();
	const activeLeases = new Map<string, NonNullable<ManagedCloudPostgresqlStoreResult["lease"]>>();
	const activeEnvelopes = new Map<string, ManagedCloudPostgresqlAdmittedEnvelope>();
	const activeCredentialLifecycle = new Map<
		string,
		readonly ManagedCloudPostgresqlCredentialLifecycleFact[]
	>();
	const settlingLeases = new Map<string, symbol>();
	const pendingCancellations = new Map<string, ManagedCloudPostgresqlCancellationRequested>();
	let disposed = false;
	const pending = new Set<Promise<unknown>>();
	const unsubscribes: Array<() => void> = [];
	const emit = <T>(node: Node<T>, value: T) => node.down([["DATA", value]]);
	const issue = (code: string, message: string) =>
		emit(issues, { code, message, severity: "error" } as DataIssue);
	const emitLifecycle = (raw: ManagedCloudPostgresqlLifecycleFact) => {
		const fact = snapshotLifecycle(raw);
		if (["expired", "lost"].includes(fact.state)) {
			const active = activeLeases.get(leaseKey(fact as ManagedCloudPostgresqlLeaseCoordinates));
			if (active === undefined) throw new TypeError("Terminal lifecycle has no active lease.");
			assertTerminalLifecycle(fact, active);
		}
		emit(lifecycle, fact);
		emit(audit, {
			id: `managed-cloud-postgresql-audit:${fact.runId ?? "session"}:${fact.attempt ?? 0}:${fact.state}:${fact.occurredAtMs}`,
			kind: `managed-cloud-postgresql-${fact.state}`,
			subjectId: fact.runId ?? fact.workerId ?? "managed-cloud-postgresql",
			metadata: {
				attempt: fact.attempt,
				leaseId: fact.leaseId,
				fencingToken: fact.fencingToken,
				sessionEpoch: fact.sessionEpoch,
				code: fact.code,
			},
		});
		if (
			["expired", "lost"].includes(fact.state) &&
			fact.runId !== undefined &&
			fact.attempt !== undefined
		) {
			const key = leaseKey({ runId: fact.runId, attempt: fact.attempt });
			activeLeases.delete(key);
			activeEnvelopes.delete(key);
			activeCredentialLifecycle.delete(key);
			settlingLeases.delete(key);
			for (const [id, request] of pendingCancellations)
				if (leaseKey(request) === key) pendingCancellations.delete(id);
		}
	};
	const publishCredentialLifecycle = (raw: ManagedCloudPostgresqlCredentialLifecycleFact) => {
		const fact = snapshotCredentialLifecycle(raw);
		emit(credentialLifecycle, fact);
		emit(audit, {
			id: `managed-cloud-postgresql-credential-audit:${fact.runId}:${fact.attempt}:${fact.state}:${fact.occurredAtMs}`,
			kind: `managed-cloud-postgresql-credential-${fact.state}`,
			subjectId: fact.runId,
			metadata: {
				attempt: fact.attempt,
				fencingToken: fact.fencingToken,
				sessionEpoch: fact.sessionEpoch,
				bindingRevision: fact.credentialBindingRevision,
				...(fact.expiresAtMs === undefined ? {} : { expiresAtMs: fact.expiresAtMs }),
				issueRefs: fact.issueRefs,
			},
		});
	};
	const acceptCredentialLifecycle = (
		raw: ManagedCloudPostgresqlCredentialLifecycleFact,
		active: NonNullable<ManagedCloudPostgresqlStoreResult["lease"]>,
		envelope: ManagedCloudPostgresqlAdmittedEnvelope,
	) => {
		const fact = snapshotCredentialLifecycle(raw);
		const key = leaseKey(fact);
		const next = [...(activeCredentialLifecycle.get(key) ?? []), fact];
		assertCredentialLifecyclePrefix(next, active, envelope, active.leaseExpiresAtMs);
		activeCredentialLifecycle.set(key, Object.freeze(next));
		publishCredentialLifecycle(fact);
	};
	const track = (work: Promise<unknown>) => {
		pending.add(work);
		void work.finally(() => pending.delete(work));
	};
	const runAsync = (work: () => Promise<void>, code: string) =>
		track(
			work().catch((caught) =>
				issue(
					code,
					caught instanceof TypeError &&
						/^(Control-store|Invalid managed-cloud)/.test(caught.message)
						? caught.message
						: "Managed-cloud runtime-private operation failed.",
				),
			),
		);
	unsubscribes.push(
		opts.inputs.subscribe((m) => {
			if (m[0] === "DATA") {
				const input = m[1] as ToolProviderAdapterInput<PostgresqlQueryToolArguments>;
				if (typeof input.adapterInputId === "string") inputs.set(input.adapterInputId, input);
			}
		}),
	);
	for (const node of opts.manifests)
		unsubscribes.push(
			node.subscribe((m) => {
				if (m[0] === "DATA") {
					try {
						manifest = managedCloudPostgresqlManifest(m[1] as ManagedCloudPostgresqlManifest);
					} catch {
						issue("managed-cloud-manifest-invalid", "Managed-cloud manifest is invalid.");
					}
				}
			}),
		);
	for (const node of opts.readiness)
		unsubscribes.push(
			node.subscribe((m) => {
				if (m[0] === "DATA") {
					try {
						posture = managedCloudPostgresqlReadiness(m[1] as ManagedCloudPostgresqlReadiness);
					} catch {
						issue("managed-cloud-readiness-invalid", "Managed-cloud readiness is invalid.");
					}
				}
			}),
		);
	for (const node of opts.admittedRunRequests)
		unsubscribes.push(
			node.subscribe((m) => {
				if (m[0] !== "DATA") return;
				const request = m[1] as ToolProviderAdapterRunRequested;
				runAsync(async () => {
					const current = readyManifest(request, manifest, posture, now());
					if (current === undefined) {
						issue("managed-cloud-admission-not-ready", "Managed-cloud admission failed closed.");
						return;
					}
					const input = inputs.get(request.adapterInputId);
					if (
						input === undefined ||
						input.status !== "ready" ||
						input.requestId !== request.requestId ||
						input.operationId !== request.operationId ||
						input.routeId !== request.routeId ||
						input.executorId !== request.executorId ||
						input.profileId !== request.profileId ||
						input.toolName !== "postgresql.query"
					) {
						issue(
							"managed-cloud-input-mismatch",
							"Managed-cloud admitted run did not match a ready PostgreSQL input.",
						);
						return;
					}
					const envelope = admittedEnvelope(request, input, current);
					const result = snapshotStoreResult(await opts.store.admit(envelope, now()));
					if (!result.accepted) {
						issue(result.code, "Managed-cloud admission was rejected.");
						return;
					}
					emit(admittedEnvelopes, envelope);
					emitLifecycle(result.lifecycle ?? lifecycleFact("queued", now(), envelope));
					emit(runStatus, {
						kind: "tool-provider-adapter-run-status",
						runId: request.runId,
						adapterInputId: request.adapterInputId,
						requestId: request.requestId,
						operationId: request.operationId,
						status: "requested",
						attempt: request.attempt,
						metadata: { queuePosture: "queued" },
					});
				}, "managed-cloud-admission-driver-failed");
			}),
		);
	for (const node of opts.cancellationRequests ?? [])
		unsubscribes.push(
			node.subscribe((m) => {
				if (m[0] !== "DATA") return;
				const request = snapshotCancellation(m[1]);
				if (request === undefined) {
					issue(
						"managed-cloud-cancellation-invalid",
						"Managed-cloud cancellation pins are invalid.",
					);
					return;
				}
				runAsync(async () => {
					const result = snapshotStoreResult(await opts.store.persistCancellation(request, now()));
					if (!result.accepted) {
						emit(cancellations, {
							kind: "managed-cloud-postgresql-cancellation-posture",
							cancellationId: request.cancellationId,
							runId: request.runId,
							attempt: request.attempt,
							state: "rejected",
							code: result.code,
						});
						return;
					}
					if (result.lifecycle === undefined)
						throw new TypeError("Accepted cancellation persistence requires lifecycle evidence.");
					assertLifecycleForLease(result.lifecycle, request, "cancel-pending");
					emitLifecycle(result.lifecycle);
					emit(cancellations, {
						kind: "managed-cloud-postgresql-cancellation-posture",
						cancellationId: request.cancellationId,
						runId: request.runId,
						attempt: request.attempt,
						state: "persisted-pending",
					});
					pendingCancellations.set(request.cancellationId, request);
					await opts.transport.send(request.workerId, request.sessionEpoch, {
						kind: "cancel",
						messageId: `cancel:${request.cancellationId}`,
						cancellationId: request.cancellationId,
						...leaseCoordinates(request),
					});
					emit(cancellations, {
						kind: "managed-cloud-postgresql-cancellation-posture",
						cancellationId: request.cancellationId,
						runId: request.runId,
						attempt: request.attempt,
						state: "dispatched-unconfirmed",
					});
				}, "managed-cloud-cancellation-driver-failed");
			}),
		);
	const onMessage = (raw: unknown) => {
		if (disposed) return;
		const message = snapshotWorkerMessage(raw);
		if (message === undefined) {
			issue("managed-cloud-envelope-invalid", "Managed-cloud worker envelope is invalid.");
			return;
		}
		runAsync(async () => {
			let settlementCredentialLifecycle:
				| readonly ManagedCloudPostgresqlCredentialLifecycleFact[]
				| undefined;
			let settlementCredentialPrefixLength = 0;
			let settlementFenceToken: symbol | undefined;
			const releaseSettlementFence = () => {
				if (
					message.kind === "settle" &&
					settlementFenceToken !== undefined &&
					settlingLeases.get(leaseKey(message)) === settlementFenceToken
				)
					settlingLeases.delete(leaseKey(message));
			};
			if (message.kind === "credential-lifecycle") {
				const active = activeLeases.get(leaseKey(message));
				const envelope = activeEnvelopes.get(leaseKey(message));
				if (active === undefined || envelope === undefined) {
					await rejectMessage(opts.transport, message, "credential-lifecycle-not-current");
					issue(
						"credential-lifecycle-not-current",
						"Managed-cloud credential lifecycle did not match a current claim.",
					);
					return;
				}
				if (settlingLeases.has(leaseKey(message))) {
					await rejectMessage(opts.transport, message, "credential-lifecycle-settling");
					issue(
						"credential-lifecycle-settling",
						"Managed-cloud credential lifecycle cannot advance during settlement.",
					);
					return;
				}
				try {
					acceptCredentialLifecycle(credentialLifecycleFactFromMessage(message), active, envelope);
				} catch {
					await rejectMessage(opts.transport, message, "credential-lifecycle-transition-invalid");
					issue(
						"credential-lifecycle-transition-invalid",
						"Managed-cloud credential lifecycle transition was invalid.",
					);
					return;
				}
				await opts.transport.send(message.workerId, message.sessionEpoch, {
					kind: "accepted",
					messageId: message.messageId,
					operation: "credential-lifecycle",
					...leaseCoordinates(message),
				});
				return;
			}
			let result: ManagedCloudPostgresqlStoreResult;
			if (message.kind === "claim") {
				const claimManifest = manifest;
				if (
					claimManifest === undefined ||
					posture === undefined ||
					ready(claimManifest, posture, now()) === false
				) {
					await rejectMessage(opts.transport, message, "managed-cloud-not-ready");
					return;
				}
				result = snapshotStoreResult(await opts.store.claim(message, claimManifest, now()));
				if (result.accepted && result.lease !== undefined) {
					const lease = snapshotClaimLease(result.lease, message, claimManifest);
					{
						const authorizationRequestedAtMs = authorityNow(now);
						let authorization: ManagedCloudPostgresqlAuthorizationRecheckResult;
						try {
							authorization = snapshotAuthorizationRecheckResult(
								await opts.authorizationRecheck.authorizeClaim({
									kind: "managed-cloud-postgresql-claim-authorization-request",
									message,
									lease,
									manifest: claimManifest,
									nowMs: now(),
								}),
								"claim",
							);
						} catch {
							authorization = authorizationUnavailableForLease(
								lease,
								lease.envelope,
								"claim",
								now(),
							);
						}
						const authorizationValidatedAtMs = authorityNow(now);
						if (
							!authorizationMatchesLease(authorization, lease, lease.envelope) ||
							!authorizationAllowsAttempt(
								authorization,
								lease.leaseExpiresAtMs,
								authorizationRequestedAtMs,
								authorizationValidatedAtMs,
							)
						) {
							if (opts.store.rejectClaim === undefined)
								throw new TypeError(
									"Managed-cloud authorization recheck requires rejectClaim support.",
								);
							const failureAuthorization = authorizationMatchesLease(
								authorization,
								lease,
								lease.envelope,
							)
								? authorization
								: authorizationUnavailableForLease(lease, lease.envelope, "claim", now());
							const rejectCode = authorizationRejectCode(failureAuthorization);
							const rejected = snapshotStoreResult(
								await opts.store.rejectClaim(lease, rejectCode, now()),
							);
							if (!rejected.accepted) {
								await rejectMessage(opts.transport, message, rejected.code);
								issue(rejected.code, "Managed-cloud claim authorization rejection failed.");
								return;
							}
							if (rejected.lifecycle !== undefined) emitLifecycle(rejected.lifecycle);
							await rejectMessage(opts.transport, message, rejectCode);
							issue(rejectCode, "Managed-cloud claim authorization failed closed.");
							return;
						}
					}
					result = { ...result, lease };
				}
			} else if (message.kind === "heartbeat")
				result = snapshotStoreResult(
					await opts.store.heartbeat(message, now() + (manifest?.heartbeatDurationMs ?? 0), now()),
				);
			else if (message.kind === "cancel-ack")
				result = snapshotStoreResult(await opts.store.acknowledgeCancellation(message, now()));
			else {
				if (message.credentialLifecycle === undefined || message.credentialLifecycle.length === 0) {
					await rejectMessage(opts.transport, message, "credential-lifecycle-required");
					issue(
						"credential-lifecycle-required",
						"Managed-cloud settlement requires attempt credential lifecycle evidence.",
					);
					return;
				}
				const active = activeLeases.get(leaseKey(message));
				const envelope = activeEnvelopes.get(leaseKey(message));
				if (active === undefined || envelope === undefined) {
					await rejectMessage(opts.transport, message, "credential-lifecycle-not-current");
					issue(
						"credential-lifecycle-not-current",
						"Managed-cloud settlement credential lifecycle did not match a current claim.",
					);
					return;
				}
				settlementCredentialLifecycle = message.credentialLifecycle.map(
					snapshotCredentialLifecycle,
				);
				const terminal = settlementCredentialLifecycle.at(-1)?.state;
				if (
					terminal !== "revoked" &&
					terminal !== "cleanup-unverifiable" &&
					terminal !== "unavailable"
				) {
					await rejectMessage(opts.transport, message, "credential-cleanup-not-terminal");
					issue(
						"credential-cleanup-not-terminal",
						"Managed-cloud settlement lacked terminal credential cleanup evidence.",
					);
					return;
				}
				assertCredentialLifecycleSequence(
					settlementCredentialLifecycle,
					active,
					envelope,
					active.leaseExpiresAtMs,
				);
				if (terminal === "unavailable" && message.outcome !== "failed") {
					await rejectMessage(opts.transport, message, "credential-unavailable-outcome-mismatch");
					issue(
						"credential-unavailable-outcome-mismatch",
						"Managed-cloud unavailable credentials can only settle a failed outcome.",
					);
					return;
				}
				if (
					!settlementCredentialLifecycle.some((fact) => fact.state === "injected") &&
					message.outcome !== "failed"
				) {
					await rejectMessage(opts.transport, message, "credential-injection-required");
					issue(
						"credential-injection-required",
						"Managed-cloud settlement without credential injection must fail before workload execution.",
					);
					return;
				}
				const settlementLeaseKey = leaseKey(message);
				if (settlingLeases.has(settlementLeaseKey)) {
					await rejectMessage(opts.transport, message, "settlement-in-progress");
					issue(
						"settlement-in-progress",
						"Managed-cloud lease already has an in-progress or reconciliation-required settlement.",
					);
					return;
				}
				settlementFenceToken = Symbol(settlementLeaseKey);
				settlingLeases.set(settlementLeaseKey, settlementFenceToken);
				const streamedCredentialLifecycle = activeCredentialLifecycle.get(settlementLeaseKey) ?? [];
				try {
					assertCredentialLifecycleSettlementPrefix(
						streamedCredentialLifecycle,
						settlementCredentialLifecycle,
					);
				} catch (caught) {
					releaseSettlementFence();
					throw caught;
				}
				settlementCredentialPrefixLength = streamedCredentialLifecycle.length;
				try {
					result = snapshotStoreResult(await opts.store.settle(message, now()));
				} catch {
					issue(
						"managed-cloud-settlement-reconciliation-required",
						"Settlement dispatch did not return trustworthy commit evidence; the lease remains fenced for reconciliation.",
					);
					return;
				}
			}
			if (!result.accepted) {
				releaseSettlementFence();
				await rejectMessage(opts.transport, message, result.code);
				issue(result.code, "Managed-cloud worker mutation was rejected.");
				return;
			}
			let validatedSettlementOutcome: ExecutorOutcome | undefined;
			if (message.kind === "settle") {
				try {
					if (result.outcome === undefined || result.lifecycle === undefined)
						throw new TypeError("Accepted settlement requires outcome and lifecycle evidence.");
					assertLifecycleForLease(result.lifecycle, message, "settled");
					const envelope = activeEnvelopes.get(leaseKey(message));
					if (envelope === undefined || settlementCredentialLifecycle === undefined)
						throw new TypeError("Accepted settlement has no current admitted evidence.");
					validatedSettlementOutcome = snapshotOutcome(result.outcome, message, envelope);
				} catch {
					issue(
						"managed-cloud-settlement-reconciliation-required",
						"The control store committed settlement but returned invalid projection evidence; the lease remains fenced for reconciliation.",
					);
					return;
				}
			}
			if (message.kind === "claim" && result.lease === undefined)
				throw new TypeError("Accepted claim requires a lease.");
			if (message.kind !== "claim") {
				if (result.lifecycle === undefined)
					throw new TypeError("Accepted worker mutation requires lifecycle evidence.");
				assertLifecycleForLease(
					result.lifecycle,
					message,
					message.kind === "heartbeat"
						? "heartbeat-current"
						: message.kind === "cancel-ack"
							? "cancel-acknowledged"
							: "settled",
				);
			} else {
				if (result.lifecycle === undefined || result.lease === undefined)
					throw new TypeError("Accepted claim requires exact claimed lifecycle evidence.");
				assertLifecycleForLease(result.lifecycle, result.lease, "claimed");
				activeLeases.set(leaseKey(result.lease), result.lease);
				activeEnvelopes.set(leaseKey(result.lease), result.lease.envelope);
				await opts.transport.send(message.workerId, message.sessionEpoch, {
					kind: "claim-granted",
					messageId: message.messageId,
					...result.lease,
				});
			}
			if (message.kind === "settle") {
				if (settlementCredentialLifecycle === undefined)
					throw new TypeError("Accepted settlement requires credential lifecycle evidence.");
				const active = activeLeases.get(leaseKey(message));
				const envelope = activeEnvelopes.get(leaseKey(message));
				if (active === undefined || envelope === undefined)
					throw new TypeError("Settlement credential lifecycle has no current claim.");
				for (const fact of settlementCredentialLifecycle.slice(settlementCredentialPrefixLength))
					acceptCredentialLifecycle(fact, active, envelope);
			}
			if (result.lifecycle !== undefined) emitLifecycle(result.lifecycle);
			if (message.kind === "cancel-ack") {
				pendingCancellations.delete(message.cancellationId);
				emit(cancellations, {
					kind: "managed-cloud-postgresql-cancellation-posture",
					cancellationId: message.cancellationId,
					runId: message.runId,
					attempt: message.attempt,
					state: "acknowledged",
				});
			}
			if (message.kind === "settle" && validatedSettlementOutcome !== undefined) {
				emit(outcomes, validatedSettlementOutcome);
				const key = leaseKey(message);
				activeLeases.delete(key);
				activeEnvelopes.delete(key);
				activeCredentialLifecycle.delete(key);
				releaseSettlementFence();
				for (const [id, request] of pendingCancellations)
					if (leaseKey(request) === key) pendingCancellations.delete(id);
			}
			if (message.kind !== "claim")
				await opts.transport.send(message.workerId, message.sessionEpoch, {
					kind: "accepted",
					messageId: message.messageId,
					operation: message.kind,
					...leaseCoordinates(message),
				});
		}, "managed-cloud-worker-driver-failed");
	};
	const onDisconnect = (workerId: string, sessionEpoch: string) =>
		runAsync(async () => {
			if (disposed) return;
			assertSafe(workerId, "workerId");
			assertSafe(sessionEpoch, "sessionEpoch");
			for (const fact of await opts.store.disconnect(workerId, sessionEpoch, now())) {
				if (fact.workerId !== workerId || fact.sessionEpoch !== sessionEpoch)
					throw new TypeError("Disconnect lifecycle callback correlation mismatch.");
				emitLifecycle(fact);
			}
		}, "managed-cloud-disconnect-fence-failed");
	runAsync(async () => {
		await opts.transport.start(onMessage, onDisconnect);
	}, "managed-cloud-transport-start-failed");
	return {
		admittedEnvelopes,
		lifecycle,
		credentialLifecycle,
		runStatus,
		outcomes,
		cancellations,
		issues,
		audit,
		async expire() {
			for (const fact of await opts.store.expire(now())) emitLifecycle(fact);
		},
		async redeliverPendingCancellations() {
			for (const request of pendingCancellations.values()) {
				const current = activeLeases.get(leaseKey(request));
				if (
					current === undefined ||
					current.sessionEpoch !== request.sessionEpoch ||
					current.fencingToken !== request.fencingToken
				) {
					issue(
						"managed-cloud-cancellation-stale-session",
						"Pending cancellation no longer targets the current fenced session.",
					);
					continue;
				}
				await opts.transport.send(request.workerId, request.sessionEpoch, {
					kind: "cancel",
					messageId: `cancel:${request.cancellationId}:redelivery`,
					cancellationId: request.cancellationId,
					...leaseCoordinates(request),
				});
			}
		},
		async dispose() {
			if (!disposed) {
				disposed = true;
				for (const unsubscribe of unsubscribes) unsubscribe();
				await Promise.resolve(opts.transport.close()).catch(() => undefined);
				await Promise.race([
					Promise.allSettled([...pending]),
					new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
				]);
				await Promise.resolve(opts.store.close()).catch(() => undefined);
				activeLeases.clear();
				activeEnvelopes.clear();
				activeCredentialLifecycle.clear();
				settlingLeases.clear();
				pendingCancellations.clear();
			}
			try {
				group.release({ reason: `${name}:dispose` });
			} catch {}
		},
	};
}

function admittedEnvelope(
	request: ToolProviderAdapterRunRequested,
	input: ToolProviderAdapterInput<PostgresqlQueryToolArguments>,
	manifest: ManagedCloudPostgresqlManifest,
): ManagedCloudPostgresqlAdmittedEnvelope {
	const metadata = request.metadata as Record<string, unknown> | undefined;
	const environmentRevision = metadata?.executionEnvironmentRevision;
	const admissionId = metadata?.admissionId;
	const admissionProposalId = metadata?.proposalId;
	const admissionDecisionId = metadata?.decisionId;
	const principalId = metadata?.principalId;
	const principalSessionRevision = metadata?.principalSessionRevision;
	const tenantId = metadata?.tenantId;
	const workspaceId = metadata?.workspaceId;
	const resourceKind = metadata?.resourceKind;
	const resourceId = metadata?.resourceId;
	const resourceRevision = metadata?.resourceRevision;
	const policyRevision = metadata?.policyRevision;
	const modelRevision = metadata?.modelRevision;
	for (const value of [
		request.runId,
		request.requestId,
		request.operationId,
		request.routeId,
		request.executorId,
		request.profileId,
		environmentRevision,
		admissionId,
		principalId,
		principalSessionRevision,
		tenantId,
		workspaceId,
		resourceKind,
		resourceId,
		resourceRevision,
		policyRevision,
		modelRevision,
	])
		assertSafe(value, "admitted coordinate");
	assertBoundedAuthorityId(admissionProposalId, "admission proposal coordinate");
	if (admissionDecisionId !== undefined) {
		assertSafe(admissionDecisionId, "admission decision coordinate");
	}
	const requestRefs = refs(request.sourceRefs ?? []);
	if (
		!requestRefs.some(
			(ref) => ref.kind === "tool-provider-run-admission" && ref.id === admissionId,
		) ||
		!requestRefs.some(
			(ref) =>
				ref.kind === "tool-provider-run-admission-proposal" && ref.id === admissionProposalId,
		) ||
		(admissionDecisionId !== undefined &&
			!requestRefs.some(
				(ref) =>
					ref.kind === "tool-provider-run-admission-decision" && ref.id === admissionDecisionId,
			))
	) {
		throw new TypeError("Managed-cloud admission evidence does not match its exact coordinates.");
	}
	if (typeof request.adapterInputId !== "string" || request.adapterInputId.length > 512)
		throw new TypeError("Invalid adapter input coordinate.");
	if (!Number.isSafeInteger(request.attempt) || request.attempt < 1)
		throw new TypeError("Invalid admitted attempt.");
	const workload = postgresqlQueryToolArgumentsFromIntent(
		input.toolCall?.arguments as PostgresqlQueryToolArguments,
	);
	return snapshotAdmittedEnvelope({
		kind: "managed-cloud-postgresql-admitted-envelope",
		protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
		runId: request.runId,
		attempt: request.attempt,
		environmentRevision: environmentRevision as string,
		manifestFingerprint: manifest.fingerprint,
		requestId: request.requestId,
		operationId: request.operationId,
		routeId: request.routeId as string,
		executorId: request.executorId as string,
		profileId: request.profileId as string,
		adapterInputId: request.adapterInputId,
		principalId: principalId as string,
		principalSessionRevision: principalSessionRevision as string,
		tenantId: tenantId as string,
		workspaceId: workspaceId as string,
		resourceKind: resourceKind as string,
		resourceId: resourceId as string,
		resourceRevision: resourceRevision as string,
		policyRevision: policyRevision as string,
		modelRevision: modelRevision as string,
		admissionId: admissionId as string,
		admissionProposalId: admissionProposalId as string,
		...(admissionDecisionId === undefined
			? {}
			: { admissionDecisionId: admissionDecisionId as string }),
		credentialBindingRevision: manifest.credentialBindingRevision,
		deploymentRevision: manifest.deploymentRevision,
		workerRevision: manifest.workerRevision,
		workload,
		sourceRefs: refs([
			...requestRefs,
			...(input.sourceRefs ?? []).map((ref) => ({ kind: ref.kind, id: ref.id })),
		]),
	});
}
function readyManifest(
	request: ToolProviderAdapterRunRequested,
	manifest: ManagedCloudPostgresqlManifest | undefined,
	posture: ManagedCloudPostgresqlReadiness | undefined,
	nowMs: number,
) {
	const metadata = request.metadata as Record<string, unknown> | undefined;
	if (
		manifest === undefined ||
		posture === undefined ||
		metadata?.executionEnvironmentLocality !== "managed-cloud" ||
		metadata.executionEnvironmentBindingKind !== "remote-session" ||
		metadata.executionManifestFingerprint !== manifest.fingerprint ||
		!ready(manifest, posture, nowMs)
	)
		return undefined;
	return manifest;
}
function ready(
	manifest: ManagedCloudPostgresqlManifest,
	posture: ManagedCloudPostgresqlReadiness,
	nowMs: number,
) {
	return (
		posture.manifestFingerprint === manifest.fingerprint &&
		manifest.deploymentProfile === MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE &&
		posture.deploymentProfile === manifest.deploymentProfile &&
		posture.state === "ready" &&
		posture.observedAtMs <= nowMs &&
		posture.expiresAtMs > nowMs &&
		posture.controlStoreReachable &&
		posture.schemaVerified &&
		posture.transportReady &&
		posture.workerPoolReady &&
		posture.quotaReady &&
		posture.artifactResolverReady &&
		posture.credentialResolverReady
	);
}
function lifecycleFact(
	state: ManagedCloudPostgresqlLifecycleState,
	occurredAtMs: number,
	coords: ManagedCloudPostgresqlCoordinates,
): ManagedCloudPostgresqlLifecycleFact {
	return {
		kind: "managed-cloud-postgresql-lifecycle-fact",
		state,
		runId: coords.runId,
		attempt: coords.attempt,
		occurredAtMs,
	};
}
function leaseLifecycle(
	state: ManagedCloudPostgresqlLifecycleState,
	coordinates: ManagedCloudPostgresqlLeaseCoordinates,
	occurredAtMs: number,
): ManagedCloudPostgresqlLifecycleFact {
	return Object.freeze({
		kind: "managed-cloud-postgresql-lifecycle-fact",
		state,
		...leaseCoordinates(coordinates),
		occurredAtMs,
	});
}
function settlementEvidence(
	outcome: ExecutorOutcome,
	input: Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "settle" }>,
): ExecutorOutcome {
	const evidenceRefs = refs(input.outcomeRefs);
	const issueRefs = refs(input.issueRefs);
	const metadata = { ...(outcome.metadata ?? {}), issueRefs };
	if (outcome.kind === "failure")
		return {
			...outcome,
			evidenceRefs,
			error: { ...outcome.error, sourceRefs: issueRefs },
			metadata,
		} as unknown as ExecutorOutcome;
	return { ...outcome, evidenceRefs, metadata };
}
function leaseCoordinates(
	value: ManagedCloudPostgresqlLeaseCoordinates,
): ManagedCloudPostgresqlLeaseCoordinates {
	return {
		runId: value.runId,
		attempt: value.attempt,
		environmentRevision: value.environmentRevision,
		manifestFingerprint: value.manifestFingerprint,
		leaseId: value.leaseId,
		fencingToken: value.fencingToken,
		workerId: value.workerId,
		sessionEpoch: value.sessionEpoch,
		deploymentRevision: value.deploymentRevision,
		workerRevision: value.workerRevision,
	};
}
function credentialLifecycleFactFromMessage(
	message: Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "credential-lifecycle" }>,
): ManagedCloudPostgresqlCredentialLifecycleFact {
	return {
		kind: "managed-cloud-postgresql-credential-lifecycle-fact",
		state: message.state,
		credentialBindingRevision: message.credentialBindingRevision,
		occurredAtMs: message.occurredAtMs,
		...(message.expiresAtMs === undefined ? {} : { expiresAtMs: message.expiresAtMs }),
		evidenceRefs: message.evidenceRefs,
		issueRefs: message.issueRefs,
		...leaseCoordinates(message),
	};
}
function credentialLifecycleIssueRefs(
	lifecycle: readonly ManagedCloudPostgresqlCredentialLifecycleFact[] | undefined,
): readonly SourceRef[] {
	const collected = refs(lifecycle?.flatMap((fact) => fact.issueRefs) ?? []);
	return collected.length > 0
		? collected
		: [{ kind: "issue", id: "managed-cloud-attempt-unavailable" }];
}
function snapshotAuthorizationRecheckResult(
	raw: ManagedCloudPostgresqlAuthorizationRecheckResult,
	stage: ManagedCloudPostgresqlAuthorizationRecheckStage,
): ManagedCloudPostgresqlAuthorizationRecheckResult {
	assertPlainRecord(raw, "authorization recheck result");
	if (
		!exactKeysOptional(
			raw,
			[
				"kind",
				"stage",
				"state",
				"runId",
				"attempt",
				"environmentRevision",
				"manifestFingerprint",
				"leaseId",
				"fencingToken",
				"workerId",
				"sessionEpoch",
				"deploymentRevision",
				"workerRevision",
				"requestId",
				"operationId",
				"routeId",
				"executorId",
				"profileId",
				"adapterInputId",
				"principalId",
				"principalSessionRevision",
				"tenantId",
				"workspaceId",
				"resourceKind",
				"resourceId",
				"resourceRevision",
				"policyRevision",
				"modelRevision",
				"admissionId",
				"admissionProposalId",
				"decisionRef",
				"grantGeneration",
				"grantHighWater",
				"observedAtMs",
				"issueRefs",
				"auditRefs",
			],
			[
				"admissionDecisionId",
				"authorizationRevisionRef",
				"authorizationExpiresAtMs",
				"credentialBindingRevision",
			],
		) ||
		raw.kind !== "managed-cloud-postgresql-authorization-recheck-result" ||
		raw.stage !== stage ||
		!["allowed", "denied", "unavailable", "revoked", "expired"].includes(String(raw.state)) ||
		!positive(raw.attempt) ||
		!positive(raw.fencingToken) ||
		!Number.isSafeInteger(raw.grantGeneration) ||
		raw.grantGeneration < 0 ||
		!Number.isSafeInteger(raw.grantHighWater) ||
		raw.grantHighWater < raw.grantGeneration ||
		!Number.isSafeInteger(raw.observedAtMs)
	)
		throw new TypeError("Invalid managed-cloud authorization recheck material.");
	for (const value of [
		raw.runId,
		raw.environmentRevision,
		raw.manifestFingerprint,
		raw.leaseId,
		raw.workerId,
		raw.sessionEpoch,
		raw.deploymentRevision,
		raw.workerRevision,
		raw.requestId,
		raw.operationId,
		raw.routeId,
		raw.executorId,
		raw.profileId,
		raw.principalId,
		raw.principalSessionRevision,
		raw.tenantId,
		raw.workspaceId,
		raw.resourceKind,
		raw.resourceId,
		raw.resourceRevision,
		raw.policyRevision,
		raw.modelRevision,
		raw.admissionId,
	])
		assertAuthorizationRef(value, "authorization coordinate");
	assertAuthorizationAuthorityId(raw.admissionProposalId, "authorization admission proposal");
	if (!boundedIdentity(raw.adapterInputId))
		throw new TypeError("Invalid authorization adapter input coordinate.");
	if (raw.admissionDecisionId !== undefined)
		assertAuthorizationRef(raw.admissionDecisionId, "authorization admission decision");
	if (raw.credentialBindingRevision !== undefined)
		assertAuthorizationRef(raw.credentialBindingRevision, "authorization credential binding");
	assertAuthorizationRef(raw.decisionRef, "authorization decision ref");
	if (raw.authorizationRevisionRef !== undefined)
		assertAuthorizationRef(raw.authorizationRevisionRef, "authorization revision ref");
	if (
		raw.authorizationExpiresAtMs !== undefined &&
		(!Number.isSafeInteger(raw.authorizationExpiresAtMs) ||
			raw.authorizationExpiresAtMs <= raw.observedAtMs)
	)
		throw new TypeError("Invalid managed-cloud authorization expiry.");
	if (
		raw.state === "allowed" &&
		(raw.authorizationRevisionRef === undefined || raw.authorizationExpiresAtMs === undefined)
	)
		throw new TypeError("Allowed managed-cloud authorization requires revision and expiry.");
	return Object.freeze({
		kind: "managed-cloud-postgresql-authorization-recheck-result",
		stage,
		state: raw.state,
		runId: raw.runId,
		attempt: raw.attempt,
		environmentRevision: raw.environmentRevision,
		manifestFingerprint: raw.manifestFingerprint,
		leaseId: raw.leaseId,
		fencingToken: raw.fencingToken,
		workerId: raw.workerId,
		sessionEpoch: raw.sessionEpoch,
		deploymentRevision: raw.deploymentRevision,
		workerRevision: raw.workerRevision,
		requestId: raw.requestId,
		operationId: raw.operationId,
		routeId: raw.routeId,
		executorId: raw.executorId,
		profileId: raw.profileId,
		adapterInputId: raw.adapterInputId,
		principalId: raw.principalId,
		principalSessionRevision: raw.principalSessionRevision,
		tenantId: raw.tenantId,
		workspaceId: raw.workspaceId,
		resourceKind: raw.resourceKind,
		resourceId: raw.resourceId,
		resourceRevision: raw.resourceRevision,
		policyRevision: raw.policyRevision,
		modelRevision: raw.modelRevision,
		admissionId: raw.admissionId,
		admissionProposalId: raw.admissionProposalId,
		...(raw.admissionDecisionId === undefined
			? {}
			: { admissionDecisionId: raw.admissionDecisionId }),
		decisionRef: raw.decisionRef,
		...(raw.authorizationRevisionRef === undefined
			? {}
			: { authorizationRevisionRef: raw.authorizationRevisionRef }),
		...(raw.authorizationExpiresAtMs === undefined
			? {}
			: { authorizationExpiresAtMs: raw.authorizationExpiresAtMs }),
		grantGeneration: raw.grantGeneration,
		grantHighWater: raw.grantHighWater,
		observedAtMs: raw.observedAtMs,
		issueRefs: credentialRefs(raw.issueRefs),
		auditRefs: credentialRefs(raw.auditRefs),
		...(raw.credentialBindingRevision === undefined
			? {}
			: { credentialBindingRevision: raw.credentialBindingRevision }),
	});
}
function authorizationAllowsAttempt(
	authorization: ManagedCloudPostgresqlAuthorizationRecheckResult,
	leaseExpiresAtMs: number,
	requestedAtMs: number,
	validatedAtMs: number,
): boolean {
	return (
		authorization.state === "allowed" &&
		authorization.authorizationRevisionRef !== undefined &&
		authorization.authorizationExpiresAtMs !== undefined &&
		authorization.observedAtMs >= requestedAtMs &&
		authorization.observedAtMs <= validatedAtMs &&
		validatedAtMs < leaseExpiresAtMs &&
		authorization.authorizationExpiresAtMs >= leaseExpiresAtMs
	);
}
function authorityNow(now: () => number): number {
	const value = now();
	if (!Number.isSafeInteger(value) || value < 0)
		throw new TypeError("Invalid managed-cloud authority clock value.");
	return value;
}
function authorizationMatchesLease(
	authorization: ManagedCloudPostgresqlAuthorizationRecheckResult,
	lease: ManagedCloudPostgresqlLeaseCoordinates,
	envelope: ManagedCloudPostgresqlAdmittedEnvelope,
): boolean {
	return (
		authorization.runId === lease.runId &&
		authorization.attempt === lease.attempt &&
		authorization.environmentRevision === lease.environmentRevision &&
		authorization.manifestFingerprint === lease.manifestFingerprint &&
		authorization.leaseId === lease.leaseId &&
		authorization.fencingToken === lease.fencingToken &&
		authorization.workerId === lease.workerId &&
		authorization.sessionEpoch === lease.sessionEpoch &&
		authorization.deploymentRevision === lease.deploymentRevision &&
		authorization.workerRevision === lease.workerRevision &&
		authorization.requestId === envelope.requestId &&
		authorization.operationId === envelope.operationId &&
		authorization.routeId === envelope.routeId &&
		authorization.executorId === envelope.executorId &&
		authorization.profileId === envelope.profileId &&
		authorization.adapterInputId === envelope.adapterInputId &&
		authorization.principalId === envelope.principalId &&
		authorization.principalSessionRevision === envelope.principalSessionRevision &&
		authorization.tenantId === envelope.tenantId &&
		authorization.workspaceId === envelope.workspaceId &&
		authorization.resourceKind === envelope.resourceKind &&
		authorization.resourceId === envelope.resourceId &&
		authorization.resourceRevision === envelope.resourceRevision &&
		authorization.policyRevision === envelope.policyRevision &&
		authorization.modelRevision === envelope.modelRevision &&
		authorization.admissionId === envelope.admissionId &&
		authorization.admissionProposalId === envelope.admissionProposalId &&
		authorization.admissionDecisionId === envelope.admissionDecisionId
	);
}
async function attemptAuthorizationRecheck(
	authorizationDriver: Pick<
		ManagedCloudPostgresqlAuthorizationRecheckDriver,
		"authorizeCredentialIssuance"
	>,
	context: Parameters<
		ManagedCloudPostgresqlAuthorizationRecheckDriver["authorizeCredentialIssuance"]
	>[0],
	stage: "credential-issuance",
): Promise<ManagedCloudPostgresqlAuthorizationRecheckResult | undefined> {
	try {
		return snapshotAuthorizationRecheckResult(
			await authorizationDriver.authorizeCredentialIssuance(context),
			stage,
		);
	} catch {
		return undefined;
	}
}
function authorizationUnavailableForClaim(
	claim: Extract<ManagedCloudPostgresqlControlMessage, { kind: "claim-granted" }>,
	stage: ManagedCloudPostgresqlAuthorizationRecheckStage,
): ManagedCloudPostgresqlAuthorizationRecheckResult {
	return authorizationUnavailableForLease(
		claim,
		claim.envelope,
		stage,
		0,
		stage === "credential-issuance" ? claim.envelope.credentialBindingRevision : undefined,
	);
}
function authorizationUnavailableForLease(
	lease: ManagedCloudPostgresqlLeaseCoordinates,
	envelope: ManagedCloudPostgresqlAdmittedEnvelope,
	stage: ManagedCloudPostgresqlAuthorizationRecheckStage,
	observedAtMs: number,
	credentialBindingRevision?: string,
): ManagedCloudPostgresqlAuthorizationRecheckResult {
	return Object.freeze({
		kind: "managed-cloud-postgresql-authorization-recheck-result",
		stage,
		state: "unavailable",
		...leaseCoordinates(lease),
		requestId: envelope.requestId,
		operationId: envelope.operationId,
		routeId: envelope.routeId,
		executorId: envelope.executorId,
		profileId: envelope.profileId,
		adapterInputId: envelope.adapterInputId,
		principalId: envelope.principalId,
		principalSessionRevision: envelope.principalSessionRevision,
		tenantId: envelope.tenantId,
		workspaceId: envelope.workspaceId,
		resourceKind: envelope.resourceKind,
		resourceId: envelope.resourceId,
		resourceRevision: envelope.resourceRevision,
		policyRevision: envelope.policyRevision,
		modelRevision: envelope.modelRevision,
		admissionId: envelope.admissionId,
		admissionProposalId: envelope.admissionProposalId,
		...(envelope.admissionDecisionId === undefined
			? {}
			: { admissionDecisionId: envelope.admissionDecisionId }),
		decisionRef: "authorization-decision:unavailable",
		grantGeneration: 0,
		grantHighWater: 0,
		observedAtMs,
		issueRefs: [{ kind: "issue", id: "authorization-unavailable" }],
		auditRefs: [],
		...(credentialBindingRevision === undefined ? {} : { credentialBindingRevision }),
	});
}
function authorizationRejectCode(
	authorization: ManagedCloudPostgresqlAuthorizationRecheckResult,
): string {
	return authorization.state === "expired"
		? "authorization-expired"
		: authorization.state === "revoked"
			? "authorization-revoked"
			: authorization.state === "denied"
				? "authorization-denied"
				: "authorization-unavailable";
}
function authorizationIssueRefs(
	authorization: ManagedCloudPostgresqlAuthorizationRecheckResult,
): readonly SourceRef[] {
	const collected = refs(authorization.issueRefs);
	return collected.length > 0
		? collected
		: [{ kind: "issue", id: authorizationRejectCode(authorization) }];
}
function authorizationCredentialUnavailableLifecycle(
	claim: Extract<ManagedCloudPostgresqlControlMessage, { kind: "claim-granted" }>,
	authorization: ManagedCloudPostgresqlAuthorizationRecheckResult,
): readonly ManagedCloudPostgresqlCredentialLifecycleFact[] {
	const issueRequested = Object.freeze({
		kind: "managed-cloud-postgresql-credential-lifecycle-fact" as const,
		state: "issue-requested" as const,
		...leaseCoordinates(claim),
		credentialBindingRevision: claim.envelope.credentialBindingRevision,
		occurredAtMs: authorization.observedAtMs,
		evidenceRefs: [{ kind: "decision", id: authorization.decisionRef }],
		issueRefs: [],
	});
	const unavailable = Object.freeze({
		kind: "managed-cloud-postgresql-credential-lifecycle-fact",
		state: "unavailable" as const,
		...leaseCoordinates(claim),
		credentialBindingRevision: claim.envelope.credentialBindingRevision,
		occurredAtMs: authorization.observedAtMs,
		evidenceRefs: [{ kind: "decision", id: authorization.decisionRef }],
		issueRefs: authorizationIssueRefs(authorization),
	});
	return Object.freeze([issueRequested, unavailable]);
}
function snapshotCredentialLifecycleSequence(
	raw: readonly ManagedCloudPostgresqlCredentialLifecycleFact[],
	claim: Extract<ManagedCloudPostgresqlControlMessage, { kind: "claim-granted" }>,
): readonly ManagedCloudPostgresqlCredentialLifecycleFact[] {
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > 16)
		throw new TypeError("Invalid managed-cloud credential lifecycle sequence.");
	const lifecycle = raw.map(snapshotCredentialLifecycle);
	const terminal = lifecycle.at(-1)?.state;
	if (terminal !== "revoked" && terminal !== "cleanup-unverifiable" && terminal !== "unavailable")
		throw new TypeError("Managed-cloud credential lifecycle lacks terminal cleanup posture.");
	assertCredentialLifecycleSequence(lifecycle, claim, claim.envelope, claim.leaseExpiresAtMs);
	return Object.freeze(lifecycle);
}
function snapshotCredentialLifecyclePreparation(
	raw: readonly ManagedCloudPostgresqlCredentialLifecycleFact[],
	claim: Extract<ManagedCloudPostgresqlControlMessage, { kind: "claim-granted" }>,
	ready: boolean,
): readonly ManagedCloudPostgresqlCredentialLifecycleFact[] {
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > 16)
		throw new TypeError("Invalid managed-cloud credential preparation sequence.");
	const lifecycle = raw.map(snapshotCredentialLifecycle);
	for (let index = 0; index < lifecycle.length; index += 1) {
		const fact = lifecycle[index]!;
		assertCredentialLifecycleForLease(fact, claim, claim.envelope, claim.leaseExpiresAtMs);
		if (index > 0 && fact.occurredAtMs < lifecycle[index - 1]!.occurredAtMs)
			throw new TypeError("Credential preparation timestamps are not monotonic.");
	}
	const states = lifecycle.map((fact) => fact.state).join(">");
	const valid = ready
		? states === "issue-requested>issued>injected"
		: new Set([
				"issue-requested>unavailable",
				"issue-requested>cleanup-unverifiable",
				"issue-requested>issued>revoking>revoked",
				"issue-requested>issued>revoking>cleanup-unverifiable",
			]).has(states);
	if (!valid) throw new TypeError("Invalid managed-cloud credential preparation posture.");
	return Object.freeze(lifecycle);
}
async function terminalCredentialCleanup(
	driver: ManagedCloudPostgresqlAttemptCredentialDriver,
	context: ManagedCloudPostgresqlAttemptCredentialContext,
	claim: Extract<ManagedCloudPostgresqlControlMessage, { kind: "claim-granted" }>,
	prepared: readonly ManagedCloudPostgresqlCredentialLifecycleFact[] | undefined,
	now: () => number,
): Promise<{
	readonly lifecycle: readonly ManagedCloudPostgresqlCredentialLifecycleFact[];
	readonly issueRefs: readonly SourceRef[];
}> {
	try {
		const cleanup = await driver.cleanupAttemptCredential(context);
		const lifecycle = snapshotCredentialLifecycleSequence(cleanup.lifecycle, claim);
		if (prepared !== undefined) assertCredentialLifecycleSettlementPrefix(prepared, lifecycle);
		return {
			lifecycle,
			issueRefs: credentialRefs(cleanup.issueRefs ?? []),
		};
	} catch {
		const preparedAtMs = prepared?.at(-1)?.occurredAtMs ?? 0;
		let observedAtMs = preparedAtMs;
		try {
			observedAtMs = authorityNow(now);
		} catch {
			// Cleanup evidence must still terminate fail-closed when the authority clock is unavailable.
		}
		const occurredAtMs = Math.max(observedAtMs, preparedAtMs);
		const issueRefs = [{ kind: "issue", id: "credential-cleanup-unverifiable" }] as const;
		const prefix =
			prepared === undefined
				? [credentialCleanupFact(claim, "issue-requested", occurredAtMs, [])]
				: [...prepared, credentialCleanupFact(claim, "revoking", occurredAtMs, [])];
		const lifecycle = snapshotCredentialLifecycleSequence(
			[...prefix, credentialCleanupFact(claim, "cleanup-unverifiable", occurredAtMs, issueRefs)],
			claim,
		);
		return { lifecycle, issueRefs };
	}
}
function credentialCleanupFact(
	claim: Extract<ManagedCloudPostgresqlControlMessage, { kind: "claim-granted" }>,
	state: "issue-requested" | "revoking" | "cleanup-unverifiable",
	occurredAtMs: number,
	issueRefs: readonly SourceRef[],
): ManagedCloudPostgresqlCredentialLifecycleFact {
	return {
		kind: "managed-cloud-postgresql-credential-lifecycle-fact",
		state,
		...leaseCoordinates(claim),
		credentialBindingRevision: claim.envelope.credentialBindingRevision,
		occurredAtMs,
		...(state === "revoking" ? { expiresAtMs: claim.leaseExpiresAtMs } : {}),
		evidenceRefs: [{ kind: "evidence", id: `host-${state}` }],
		issueRefs,
	};
}
function failedCredentialSettlement(
	claim: Extract<ManagedCloudPostgresqlControlMessage, { kind: "claim-granted" }>,
	settlementId: string,
	messageId: string,
	credentialLifecycle: readonly ManagedCloudPostgresqlCredentialLifecycleFact[],
	issueRefs: readonly SourceRef[],
): Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "settle" }> {
	return Object.freeze({
		kind: "settle",
		messageId,
		settlementId,
		outcome: "failed",
		outcomeRefs: [],
		issueRefs: credentialRefs(issueRefs),
		credentialLifecycle,
		...leaseCoordinates(claim),
	});
}
async function rejectMessage(
	transport: ManagedCloudPostgresqlTransportDriver,
	message: ManagedCloudPostgresqlWorkerMessage,
	code: string,
) {
	await transport.send(message.workerId, message.sessionEpoch, {
		kind: "rejected",
		messageId: message.messageId,
		code,
	});
}
function snapshotCancellation(
	raw: unknown,
): ManagedCloudPostgresqlCancellationRequested | undefined {
	if (
		!isRecord(raw) ||
		raw.kind !== "managed-cloud-postgresql-cancellation-requested" ||
		!exactKeysOptional(
			raw,
			[
				"kind",
				"cancellationId",
				"runId",
				"attempt",
				"environmentRevision",
				"manifestFingerprint",
				"leaseId",
				"fencingToken",
				"workerId",
				"sessionEpoch",
				"deploymentRevision",
				"workerRevision",
			],
			[],
		)
	)
		return undefined;
	try {
		for (const k of [
			"cancellationId",
			"runId",
			"environmentRevision",
			"manifestFingerprint",
			"leaseId",
			"workerId",
			"sessionEpoch",
			"deploymentRevision",
			"workerRevision",
		])
			assertSafe(raw[k], k);
		if (!positive(raw.attempt) || !positive(raw.fencingToken)) return undefined;
		return Object.freeze({ ...raw }) as unknown as ManagedCloudPostgresqlCancellationRequested;
	} catch {
		return undefined;
	}
}
function snapshotWorkerMessage(raw: unknown): ManagedCloudPostgresqlWorkerMessage | undefined {
	if (
		!isRecord(raw) ||
		!["claim", "heartbeat", "cancel-ack", "credential-lifecycle", "settle"].includes(
			String(raw.kind),
		)
	)
		return undefined;
	try {
		for (const k of [
			"messageId",
			"workerId",
			"sessionEpoch",
			"environmentRevision",
			"deploymentRevision",
			"workerRevision",
		])
			assertSafe(raw[k], k);
		if (raw.kind === "claim") {
			if (
				!exactKeys(raw, [
					"kind",
					"messageId",
					"protocolRevision",
					"workerId",
					"sessionEpoch",
					"environmentRevision",
					"deploymentRevision",
					"workerRevision",
					"authAttestationRef",
				]) ||
				raw.protocolRevision !== MANAGED_CLOUD_POSTGRESQL_PROTOCOL
			)
				return undefined;
			assertSafe(raw.deploymentRevision, "deploymentRevision");
			assertSafe(raw.workerRevision, "workerRevision");
			const authAttestationRef = refs([raw.authAttestationRef])[0];
			return Object.freeze({
				...raw,
				authAttestationRef,
			}) as unknown as ManagedCloudPostgresqlWorkerMessage;
		}
		for (const k of ["runId", "manifestFingerprint", "leaseId"]) assertSafe(raw[k], k);
		if (!positive(raw.attempt) || !positive(raw.fencingToken)) return undefined;
		if (
			raw.kind === "heartbeat" &&
			exactKeys(raw, [
				"kind",
				"messageId",
				"runId",
				"attempt",
				"environmentRevision",
				"manifestFingerprint",
				"leaseId",
				"fencingToken",
				"workerId",
				"sessionEpoch",
				"deploymentRevision",
				"workerRevision",
			])
		)
			return Object.freeze({ ...raw }) as unknown as ManagedCloudPostgresqlWorkerMessage;
		if (
			raw.kind === "cancel-ack" &&
			exactKeys(raw, [
				"kind",
				"messageId",
				"cancellationId",
				"runId",
				"attempt",
				"environmentRevision",
				"manifestFingerprint",
				"leaseId",
				"fencingToken",
				"workerId",
				"sessionEpoch",
				"deploymentRevision",
				"workerRevision",
			])
		) {
			assertSafe(raw.cancellationId, "cancellationId");
			return Object.freeze({ ...raw }) as unknown as ManagedCloudPostgresqlWorkerMessage;
		}
		if (
			raw.kind === "credential-lifecycle" &&
			exactKeysOptional(
				raw,
				[
					"kind",
					"messageId",
					"credentialBindingRevision",
					"state",
					"occurredAtMs",
					"evidenceRefs",
					"issueRefs",
					"runId",
					"attempt",
					"environmentRevision",
					"manifestFingerprint",
					"leaseId",
					"fencingToken",
					"workerId",
					"sessionEpoch",
					"deploymentRevision",
					"workerRevision",
				],
				["expiresAtMs"],
			) &&
			[
				"issue-requested",
				"issued",
				"injected",
				"revoking",
				"revoked",
				"cleanup-unverifiable",
				"unavailable",
			].includes(String(raw.state)) &&
			(["issued", "injected", "revoking"].includes(String(raw.state))
				? Number.isSafeInteger(raw.expiresAtMs) && (raw.expiresAtMs as number) > 0
				: raw.expiresAtMs === undefined)
		) {
			assertSafe(raw.credentialBindingRevision, "credentialBindingRevision");
			return Object.freeze({
				...raw,
				evidenceRefs: credentialRefs(raw.evidenceRefs),
				issueRefs: credentialRefs(raw.issueRefs),
			}) as unknown as ManagedCloudPostgresqlWorkerMessage;
		}
		if (
			raw.kind === "settle" &&
			exactKeysOptional(
				raw,
				[
					"kind",
					"messageId",
					"settlementId",
					"outcome",
					"outcomeRefs",
					"issueRefs",
					"runId",
					"attempt",
					"environmentRevision",
					"manifestFingerprint",
					"leaseId",
					"fencingToken",
					"workerId",
					"sessionEpoch",
					"deploymentRevision",
					"workerRevision",
				],
				["credentialLifecycle"],
			) &&
			["succeeded", "failed", "canceled"].includes(String(raw.outcome))
		) {
			assertSafe(raw.settlementId, "settlementId");
			const credentialLifecycle =
				raw.credentialLifecycle === undefined
					? undefined
					: Array.isArray(raw.credentialLifecycle) && raw.credentialLifecycle.length <= 16
						? raw.credentialLifecycle.map((fact) =>
								snapshotCredentialLifecycle(fact as ManagedCloudPostgresqlCredentialLifecycleFact),
							)
						: undefined;
			if (raw.credentialLifecycle !== undefined && credentialLifecycle === undefined)
				return undefined;
			return Object.freeze({
				...raw,
				outcomeRefs: refs(raw.outcomeRefs),
				issueRefs: refs(raw.issueRefs),
				...(credentialLifecycle === undefined ? {} : { credentialLifecycle }),
			}) as unknown as ManagedCloudPostgresqlWorkerMessage;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
function refs(raw: unknown): readonly SourceRef[] {
	if (
		!Array.isArray(raw) ||
		raw.length > MAX_REFS ||
		raw.some(
			(v) =>
				!isRecord(v) ||
				!exactKeys(v, ["kind", "id"]) ||
				typeof v.kind !== "string" ||
				typeof v.id !== "string" ||
				!SAFE.test(v.kind) ||
				!safeSourceRefId(v.id),
		)
	)
		throw new TypeError("Invalid bounded source refs.");
	return Object.freeze(
		raw.map((v) => Object.freeze({ kind: v.kind as string, id: v.id as string })),
	);
}
function safeSourceRefId(value: string, depth = 0): boolean {
	if (SAFE.test(value)) return true;
	if (depth >= 4 || value.length === 0 || value.length > 512) return false;
	const separator = value.indexOf(":");
	if (separator < 1 || !SAFE.test(value.slice(0, separator))) return false;
	const encodedTuple = value.slice(separator + 1);
	const tuple = parseCanonicalTupleKey(encodedTuple);
	return (
		tuple !== undefined &&
		canonicalTupleKey(tuple) === encodedTuple &&
		tuple.length > 0 &&
		tuple.length <= 16 &&
		tuple.every((part) => safeSourceRefId(part, depth + 1))
	);
}
function assertBoundedAuthorityId(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !safeSourceRefId(value))
		throw new TypeError(`Invalid ${label}.`);
}
const credentialPrivateTerms = [
	"apikey",
	"client",
	"connectionstring",
	"dsn",
	"endpoint",
	"leaseid",
	"openbao",
	"password",
	"path",
	"privatekey",
	"role",
	"secret",
	"socket",
	"spiffe",
	"svid",
	"token",
	"vault",
];
function credentialRefs(raw: unknown): readonly SourceRef[] {
	const value = refs(raw);
	for (const ref of value) {
		const text = `${ref.kind}:${ref.id}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
		if (credentialPrivateTerms.some((term) => text.includes(term)))
			throw new TypeError("Credential lifecycle ref contains private material.");
	}
	return value;
}
function assertAuthorizationRef(value: unknown, name: string) {
	assertSafe(value, name);
	assertNoPrivateAuthorizationTerm(value);
}
function assertAuthorizationAuthorityId(value: unknown, name: string) {
	assertBoundedAuthorityId(value, name);
	assertNoPrivateAuthorizationTerm(value);
}
function assertNoPrivateAuthorizationTerm(value: string) {
	const text = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
	if (credentialPrivateTerms.some((term) => text.includes(term)))
		throw new TypeError("Authorization recheck ref contains private material.");
}
function snapshotStoreResult(
	raw: ManagedCloudPostgresqlStoreResult,
): ManagedCloudPostgresqlStoreResult {
	assertPlainRecord(raw, "control-store result");
	if (
		!exactKeysOptional(raw, ["accepted", "code"], ["lifecycle", "lease", "outcome"]) ||
		typeof raw.accepted !== "boolean"
	)
		throw new TypeError("Invalid control-store result.");
	assertSafe(raw.code, "control-store result code");
	return {
		accepted: raw.accepted,
		code: raw.code,
		...(raw.lifecycle === undefined ? {} : { lifecycle: snapshotLifecycle(raw.lifecycle) }),
		...(raw.lease === undefined ? {} : { lease: raw.lease }),
		...(raw.outcome === undefined ? {} : { outcome: raw.outcome }),
	};
}
function snapshotAdmittedEnvelope(raw: unknown): ManagedCloudPostgresqlAdmittedEnvelope {
	assertPlainRecord(raw, "admitted envelope");
	if (
		!exactKeysOptional(
			raw,
			[
				"kind",
				"protocolRevision",
				"runId",
				"attempt",
				"environmentRevision",
				"manifestFingerprint",
				"requestId",
				"operationId",
				"routeId",
				"executorId",
				"profileId",
				"adapterInputId",
				"principalId",
				"principalSessionRevision",
				"tenantId",
				"workspaceId",
				"resourceKind",
				"resourceId",
				"resourceRevision",
				"policyRevision",
				"modelRevision",
				"admissionId",
				"admissionProposalId",
				"credentialBindingRevision",
				"deploymentRevision",
				"workerRevision",
				"workload",
				"sourceRefs",
			],
			["admissionDecisionId"],
		) ||
		raw.kind !== "managed-cloud-postgresql-admitted-envelope" ||
		raw.protocolRevision !== MANAGED_CLOUD_POSTGRESQL_PROTOCOL ||
		!positive(raw.attempt)
	)
		throw new TypeError("Invalid admitted envelope.");
	for (const key of [
		"runId",
		"environmentRevision",
		"manifestFingerprint",
		"requestId",
		"operationId",
		"routeId",
		"executorId",
		"profileId",
		"principalId",
		"principalSessionRevision",
		"tenantId",
		"workspaceId",
		"resourceKind",
		"resourceId",
		"resourceRevision",
		"policyRevision",
		"modelRevision",
		"admissionId",
		"credentialBindingRevision",
		"deploymentRevision",
		"workerRevision",
	] as const)
		assertSafe(raw[key], `admitted envelope ${key}`);
	assertBoundedAuthorityId(raw.admissionProposalId, "admitted envelope admissionProposalId");
	if (!boundedIdentity(raw.adapterInputId))
		throw new TypeError("Invalid admitted envelope adapter input coordinate.");
	if (raw.admissionDecisionId !== undefined)
		assertSafe(raw.admissionDecisionId, "admitted envelope admissionDecisionId");
	const sourceRefs = refs(raw.sourceRefs);
	if (
		!sourceRefs.some(
			(ref) => ref.kind === "tool-provider-run-admission" && ref.id === raw.admissionId,
		) ||
		!sourceRefs.some(
			(ref) =>
				ref.kind === "tool-provider-run-admission-proposal" && ref.id === raw.admissionProposalId,
		) ||
		(raw.admissionDecisionId !== undefined &&
			!sourceRefs.some(
				(ref) =>
					ref.kind === "tool-provider-run-admission-decision" && ref.id === raw.admissionDecisionId,
			))
	)
		throw new TypeError("Admitted envelope evidence correlation mismatch.");
	return Object.freeze({
		kind: "managed-cloud-postgresql-admitted-envelope",
		protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
		runId: raw.runId as string,
		attempt: raw.attempt as number,
		environmentRevision: raw.environmentRevision as string,
		manifestFingerprint: raw.manifestFingerprint as string,
		requestId: raw.requestId as string,
		operationId: raw.operationId as string,
		routeId: raw.routeId as string,
		executorId: raw.executorId as string,
		profileId: raw.profileId as string,
		adapterInputId: raw.adapterInputId as string,
		principalId: raw.principalId as string,
		principalSessionRevision: raw.principalSessionRevision as string,
		tenantId: raw.tenantId as string,
		workspaceId: raw.workspaceId as string,
		resourceKind: raw.resourceKind as string,
		resourceId: raw.resourceId as string,
		resourceRevision: raw.resourceRevision as string,
		policyRevision: raw.policyRevision as string,
		modelRevision: raw.modelRevision as string,
		admissionId: raw.admissionId as string,
		admissionProposalId: raw.admissionProposalId as string,
		...(raw.admissionDecisionId === undefined
			? {}
			: { admissionDecisionId: raw.admissionDecisionId as string }),
		credentialBindingRevision: raw.credentialBindingRevision as string,
		deploymentRevision: raw.deploymentRevision as string,
		workerRevision: raw.workerRevision as string,
		workload: postgresqlQueryToolArgumentsFromIntent(raw.workload as PostgresqlQueryToolArguments),
		sourceRefs,
	});
}
function snapshotClaimLease(
	raw: NonNullable<ManagedCloudPostgresqlStoreResult["lease"]>,
	claim: Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "claim" }>,
	manifest: ManagedCloudPostgresqlManifest,
) {
	assertPlainRecord(raw, "control-store lease");
	if (
		raw.workerId !== claim.workerId ||
		raw.sessionEpoch !== claim.sessionEpoch ||
		raw.environmentRevision !== claim.environmentRevision ||
		raw.manifestFingerprint !== manifest.fingerprint ||
		raw.deploymentRevision !== manifest.deploymentRevision ||
		raw.workerRevision !== manifest.workerRevision ||
		claim.deploymentRevision !== manifest.deploymentRevision ||
		claim.workerRevision !== manifest.workerRevision ||
		!positive(raw.attempt) ||
		!positive(raw.fencingToken) ||
		!Number.isSafeInteger(raw.leaseExpiresAtMs) ||
		!Number.isSafeInteger(raw.heartbeatExpiresAtMs) ||
		raw.heartbeatExpiresAtMs > raw.leaseExpiresAtMs
	)
		throw new TypeError("Control-store lease correlation mismatch.");
	for (const value of [raw.runId, raw.leaseId, raw.workerId, raw.sessionEpoch])
		assertSafe(value, "lease coordinate");
	const envelope = snapshotAdmittedEnvelope(raw.envelope);
	if (
		envelope.runId !== raw.runId ||
		envelope.attempt !== raw.attempt ||
		envelope.environmentRevision !== raw.environmentRevision ||
		envelope.manifestFingerprint !== raw.manifestFingerprint ||
		envelope.deploymentRevision !== raw.deploymentRevision ||
		envelope.workerRevision !== raw.workerRevision ||
		envelope.credentialBindingRevision !== manifest.credentialBindingRevision
	)
		throw new TypeError("Control-store envelope correlation mismatch.");
	return Object.freeze({
		...leaseCoordinates(raw),
		envelope,
		leaseExpiresAtMs: raw.leaseExpiresAtMs,
		heartbeatExpiresAtMs: raw.heartbeatExpiresAtMs,
	});
}
function snapshotOutcome(
	raw: ExecutorOutcome,
	message: Extract<ManagedCloudPostgresqlWorkerMessage, { kind: "settle" }>,
	envelope: ManagedCloudPostgresqlAdmittedEnvelope,
): ExecutorOutcome {
	assertBoundedPlain(raw, 0);
	if (
		!isRecord(raw) ||
		!["result", "failure", "canceled", "timeout", "blocked"].includes(String(raw.kind)) ||
		raw.attempt !== message.attempt
	)
		throw new TypeError("Control-store outcome correlation mismatch.");
	const baseKeys = [
		"kind",
		"outcomeId",
		"requestId",
		"operationId",
		"routeId",
		"executorId",
		"profileId",
		"attempt",
		"inputId",
		"inputKind",
		"metadata",
		"evidenceRefs",
	];
	const variantKeys =
		raw.kind === "result"
			? ["result"]
			: raw.kind === "failure"
				? ["error", "retryable"]
				: raw.kind === "canceled"
					? ["reason"]
					: [];
	if (!exactKeys(raw, [...baseKeys, ...variantKeys]))
		throw new TypeError("Control-store outcome contains unsupported fields.");
	for (const key of ["outcomeId", "executorId", "profileId", "inputKind"])
		assertSafe(raw[key], `outcome ${key}`);
	if (raw.inputId !== envelope.adapterInputId || !boundedIdentity(raw.inputId))
		throw new TypeError("Control-store outcome input correlation mismatch.");
	if (raw.executorId !== envelope.executorId || raw.profileId !== envelope.profileId)
		throw new TypeError("Control-store outcome executor correlation mismatch.");
	if (
		raw.requestId !== envelope.requestId ||
		raw.operationId !== envelope.operationId ||
		raw.routeId !== envelope.routeId
	)
		throw new TypeError("Control-store outcome request correlation mismatch.");
	if (
		(message.outcome === "succeeded" && raw.kind !== "result") ||
		(message.outcome === "failed" && raw.kind !== "failure") ||
		(message.outcome === "canceled" && raw.kind !== "canceled")
	)
		throw new TypeError("Control-store outcome kind correlation mismatch.");
	if (
		!isRecord(raw.metadata) ||
		!exactKeys(raw.metadata, ["runId", "sessionEpoch", "fencingToken", "issueRefs"]) ||
		raw.metadata.runId !== message.runId ||
		raw.metadata.sessionEpoch !== message.sessionEpoch ||
		raw.metadata.fencingToken !== message.fencingToken
	)
		throw new TypeError("Control-store outcome metadata mismatch.");
	refs(raw.evidenceRefs);
	refs(raw.metadata.issueRefs);
	if (raw.kind === "result") {
		if (
			!isRecord(raw.result) ||
			!exactKeys(raw.result, ["kind", "value"]) ||
			raw.result.kind !== "managed-cloud-result-refs" ||
			!isRecord(raw.result.value) ||
			!exactKeys(raw.result.value, ["outcomeRefs"])
		)
			throw new TypeError("Invalid managed-cloud result envelope.");
		refs(raw.result.value.outcomeRefs);
	} else if (raw.kind === "failure") {
		if (
			!isRecord(raw.error) ||
			!exactKeysOptional(raw.error, ["kind", "code", "message", "severity"], ["sourceRefs"]) ||
			raw.error.kind !== "issue" ||
			raw.error.severity !== "error" ||
			raw.retryable !== false
		)
			throw new TypeError("Invalid managed-cloud failure envelope.");
		assertSafe(raw.error.code, "outcome error code");
		if (!boundedIdentity(raw.error.message)) throw new TypeError("Invalid outcome error message.");
		if (raw.error.sourceRefs !== undefined) refs(raw.error.sourceRefs);
	} else if (raw.kind === "canceled" && (typeof raw.reason !== "string" || !SAFE.test(raw.reason)))
		throw new TypeError("Invalid managed-cloud cancellation reason.");
	return deepSnapshot(raw) as ExecutorOutcome;
}
function boundedIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 512 &&
		Array.from(value).every((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code >= 32 && code !== 127;
		})
	);
}
function leaseKey(value: Pick<ManagedCloudPostgresqlLeaseCoordinates, "runId" | "attempt">) {
	return `${value.runId}:${value.attempt}`;
}
function exactKeysOptional(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[],
) {
	return (
		required.every((key) => key in value) &&
		Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
	);
}
function assertBoundedPlain(value: unknown, depth: number): void {
	if (depth > 8) throw new TypeError("Store value exceeds depth bound.");
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		if (typeof value === "string" && value.length > 1024)
			throw new TypeError("Store string exceeds bound.");
		return;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("Invalid store number.");
		return;
	}
	if (Array.isArray(value)) {
		if (value.length > 64) throw new TypeError("Store array exceeds bound.");
		for (const item of value) assertBoundedPlain(item, depth + 1);
		return;
	}
	assertPlainRecord(value, "store value");
	if (Object.keys(value).length > 64) throw new TypeError("Store object exceeds bound.");
	for (const [key, item] of Object.entries(value)) {
		if (
			key !== "fencingToken" &&
			/(secret|credential|password|client|pool|handle|raw|sql|connection|endpoint|url|token|auth|tls|signedurl)/i.test(
				key,
			)
		)
			throw new TypeError("Private store material rejected.");
		assertBoundedPlain(item, depth + 1);
	}
}
function deepSnapshot(value: unknown): unknown {
	if (Array.isArray(value)) return Object.freeze(value.map(deepSnapshot));
	if (isRecord(value))
		return Object.freeze(
			Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepSnapshot(item)])),
		);
	return value;
}
function snapshotCredentialLifecycle(
	raw: ManagedCloudPostgresqlCredentialLifecycleFact,
): ManagedCloudPostgresqlCredentialLifecycleFact {
	assertPlainRecord(raw, "credential lifecycle fact");
	if (
		!exactKeysOptional(
			raw,
			[
				"kind",
				"state",
				"runId",
				"attempt",
				"environmentRevision",
				"manifestFingerprint",
				"leaseId",
				"fencingToken",
				"workerId",
				"sessionEpoch",
				"deploymentRevision",
				"workerRevision",
				"credentialBindingRevision",
				"occurredAtMs",
				"evidenceRefs",
				"issueRefs",
			],
			["expiresAtMs"],
		) ||
		raw.kind !== "managed-cloud-postgresql-credential-lifecycle-fact" ||
		![
			"issue-requested",
			"issued",
			"injected",
			"revoking",
			"revoked",
			"cleanup-unverifiable",
			"unavailable",
		].includes(raw.state) ||
		!positive(raw.attempt) ||
		!positive(raw.fencingToken) ||
		!Number.isSafeInteger(raw.occurredAtMs) ||
		raw.occurredAtMs < 0 ||
		(raw.expiresAtMs !== undefined &&
			(!Number.isSafeInteger(raw.expiresAtMs) || raw.expiresAtMs <= 0)) ||
		(["issued", "injected", "revoking"].includes(raw.state) && raw.expiresAtMs === undefined) ||
		(!["issued", "injected", "revoking"].includes(raw.state) && raw.expiresAtMs !== undefined)
	)
		throw new TypeError("Invalid managed-cloud credential lifecycle fact.");
	for (const value of [
		raw.runId,
		raw.environmentRevision,
		raw.manifestFingerprint,
		raw.leaseId,
		raw.workerId,
		raw.sessionEpoch,
		raw.deploymentRevision,
		raw.workerRevision,
		raw.credentialBindingRevision,
	])
		assertSafe(value, "credential lifecycle coordinate");
	return Object.freeze({
		kind: "managed-cloud-postgresql-credential-lifecycle-fact",
		state: raw.state,
		...leaseCoordinates(raw),
		credentialBindingRevision: raw.credentialBindingRevision,
		occurredAtMs: raw.occurredAtMs,
		...(raw.expiresAtMs === undefined ? {} : { expiresAtMs: raw.expiresAtMs }),
		evidenceRefs: credentialRefs(raw.evidenceRefs),
		issueRefs: credentialRefs(raw.issueRefs),
	});
}
function snapshotLifecycle(
	raw: ManagedCloudPostgresqlLifecycleFact,
): ManagedCloudPostgresqlLifecycleFact {
	assertPlainRecord(raw, "control-store lifecycle fact");
	if (
		!exactKeysOptional(
			raw,
			["kind", "state", "occurredAtMs"],
			[
				"runId",
				"attempt",
				"leaseId",
				"fencingToken",
				"workerId",
				"sessionEpoch",
				"environmentRevision",
				"manifestFingerprint",
				"deploymentRevision",
				"workerRevision",
				"code",
			],
		) ||
		raw.kind !== "managed-cloud-postgresql-lifecycle-fact" ||
		![
			"queued",
			"claimed",
			"heartbeat-current",
			"cancel-pending",
			"cancel-acknowledged",
			"settled",
			"expired",
			"lost",
			"rejected",
		].includes(raw.state) ||
		!Number.isSafeInteger(raw.occurredAtMs) ||
		raw.occurredAtMs < 0
	)
		throw new TypeError("Invalid control-store lifecycle fact.");
	if (
		["claimed", "heartbeat-current", "cancel-pending", "cancel-acknowledged", "settled"].includes(
			raw.state,
		) &&
		(raw.runId === undefined ||
			raw.attempt === undefined ||
			raw.leaseId === undefined ||
			raw.fencingToken === undefined ||
			raw.workerId === undefined ||
			raw.sessionEpoch === undefined ||
			raw.environmentRevision === undefined ||
			raw.manifestFingerprint === undefined ||
			raw.deploymentRevision === undefined ||
			raw.workerRevision === undefined)
	)
		throw new TypeError("Lifecycle state lacks exact lease coordinates.");
	if (
		["queued", "expired", "lost"].includes(raw.state) &&
		(raw.runId === undefined || raw.attempt === undefined)
	)
		throw new TypeError("Lifecycle state lacks run coordinates.");
	for (const value of [
		raw.runId,
		raw.leaseId,
		raw.workerId,
		raw.sessionEpoch,
		raw.environmentRevision,
		raw.manifestFingerprint,
		raw.deploymentRevision,
		raw.workerRevision,
		raw.code,
	])
		if (value !== undefined) assertSafe(value, "lifecycle coordinate");
	if (raw.attempt !== undefined && !positive(raw.attempt))
		throw new TypeError("Invalid lifecycle attempt.");
	if (raw.fencingToken !== undefined && !positive(raw.fencingToken))
		throw new TypeError("Invalid lifecycle fence.");
	return Object.freeze({ ...raw });
}
function assertLifecycleForLease(
	fact: ManagedCloudPostgresqlLifecycleFact,
	coordinates: ManagedCloudPostgresqlLeaseCoordinates,
	state: ManagedCloudPostgresqlLifecycleState,
): void {
	if (
		fact.state !== state ||
		fact.runId !== coordinates.runId ||
		fact.attempt !== coordinates.attempt ||
		fact.leaseId !== coordinates.leaseId ||
		fact.fencingToken !== coordinates.fencingToken ||
		fact.workerId !== coordinates.workerId ||
		fact.sessionEpoch !== coordinates.sessionEpoch ||
		fact.environmentRevision !== coordinates.environmentRevision ||
		fact.manifestFingerprint !== coordinates.manifestFingerprint ||
		fact.deploymentRevision !== coordinates.deploymentRevision ||
		fact.workerRevision !== coordinates.workerRevision
	)
		throw new TypeError("Lifecycle operation correlation mismatch.");
}
function assertCredentialLifecycleForLease(
	fact: ManagedCloudPostgresqlCredentialLifecycleFact,
	coordinates: ManagedCloudPostgresqlLeaseCoordinates,
	envelope: ManagedCloudPostgresqlAdmittedEnvelope,
	leaseExpiresAtMs: number,
): void {
	if (
		fact.runId !== coordinates.runId ||
		fact.attempt !== coordinates.attempt ||
		fact.leaseId !== coordinates.leaseId ||
		fact.fencingToken !== coordinates.fencingToken ||
		fact.workerId !== coordinates.workerId ||
		fact.sessionEpoch !== coordinates.sessionEpoch ||
		fact.environmentRevision !== coordinates.environmentRevision ||
		fact.manifestFingerprint !== coordinates.manifestFingerprint ||
		fact.deploymentRevision !== coordinates.deploymentRevision ||
		fact.workerRevision !== coordinates.workerRevision ||
		fact.credentialBindingRevision !== envelope.credentialBindingRevision
	)
		throw new TypeError("Credential lifecycle correlation mismatch.");
	if (
		["issued", "injected", "revoking"].includes(fact.state) &&
		fact.expiresAtMs !== leaseExpiresAtMs
	)
		throw new TypeError("Credential effective-use expiry does not match the attempt deadline.");
	if (["issued", "injected"].includes(fact.state) && fact.occurredAtMs >= leaseExpiresAtMs)
		throw new TypeError("Credential became usable after the admitted attempt deadline.");
}

function assertCredentialLifecycleSequence(
	lifecycle: readonly ManagedCloudPostgresqlCredentialLifecycleFact[],
	coordinates: ManagedCloudPostgresqlLeaseCoordinates,
	envelope: ManagedCloudPostgresqlAdmittedEnvelope,
	leaseExpiresAtMs: number,
): void {
	for (let index = 0; index < lifecycle.length; index += 1) {
		const fact = lifecycle[index]!;
		assertCredentialLifecycleForLease(fact, coordinates, envelope, leaseExpiresAtMs);
		if (index > 0 && fact.occurredAtMs < lifecycle[index - 1]!.occurredAtMs)
			throw new TypeError("Credential lifecycle timestamps are not monotonic.");
	}
	const states = lifecycle.map((fact) => fact.state).join(">");
	if (
		!new Set([
			"issue-requested>unavailable",
			"issue-requested>cleanup-unverifiable",
			"issue-requested>issued>revoking>revoked",
			"issue-requested>issued>revoking>cleanup-unverifiable",
			"issue-requested>issued>injected>revoking>revoked",
			"issue-requested>issued>injected>revoking>cleanup-unverifiable",
		]).has(states)
	)
		throw new TypeError("Illegal managed-cloud credential lifecycle transition sequence.");
}

function assertCredentialLifecyclePrefix(
	lifecycle: readonly ManagedCloudPostgresqlCredentialLifecycleFact[],
	coordinates: ManagedCloudPostgresqlLeaseCoordinates,
	envelope: ManagedCloudPostgresqlAdmittedEnvelope,
	leaseExpiresAtMs: number,
): void {
	for (let index = 0; index < lifecycle.length; index += 1) {
		const fact = lifecycle[index]!;
		assertCredentialLifecycleForLease(fact, coordinates, envelope, leaseExpiresAtMs);
		if (index > 0 && fact.occurredAtMs < lifecycle[index - 1]!.occurredAtMs)
			throw new TypeError("Credential lifecycle timestamps are not monotonic.");
	}
	const states = lifecycle.map((fact) => fact.state).join(">");
	if (
		!new Set([
			"issue-requested",
			"issue-requested>unavailable",
			"issue-requested>cleanup-unverifiable",
			"issue-requested>issued",
			"issue-requested>issued>injected",
			"issue-requested>issued>revoking",
			"issue-requested>issued>revoking>revoked",
			"issue-requested>issued>revoking>cleanup-unverifiable",
			"issue-requested>issued>injected>revoking",
			"issue-requested>issued>injected>revoking>revoked",
			"issue-requested>issued>injected>revoking>cleanup-unverifiable",
		]).has(states)
	)
		throw new TypeError("Illegal managed-cloud credential lifecycle prefix.");
}

function assertCredentialLifecycleSettlementPrefix(
	streamed: readonly ManagedCloudPostgresqlCredentialLifecycleFact[],
	settled: readonly ManagedCloudPostgresqlCredentialLifecycleFact[],
): void {
	if (streamed.length > settled.length)
		throw new TypeError("Credential settlement omitted streamed lifecycle evidence.");
	for (let index = 0; index < streamed.length; index += 1)
		if (JSON.stringify(streamed[index]) !== JSON.stringify(settled[index]))
			throw new TypeError("Credential settlement rewrote streamed lifecycle evidence.");
}

function assertTerminalLifecycle(
	fact: ManagedCloudPostgresqlLifecycleFact,
	active: ManagedCloudPostgresqlLeaseCoordinates,
) {
	const expected = { ...active, fencingToken: active.fencingToken + 1 };
	for (const key of [
		"runId",
		"attempt",
		"leaseId",
		"workerId",
		"sessionEpoch",
		"environmentRevision",
		"manifestFingerprint",
		"deploymentRevision",
		"workerRevision",
		"fencingToken",
	] as const)
		if (fact[key] !== expected[key])
			throw new TypeError("Terminal lifecycle lease correlation mismatch.");
}
function assertPlainRecord(
	value: unknown,
	label: string,
): asserts value is Record<string, unknown> {
	if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype)
		throw new TypeError(`Invalid ${label}.`);
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
	return (
		Object.keys(value).length === keys.length &&
		Object.keys(value).every((key) => keys.includes(key))
	);
}
function assertSafe(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !SAFE.test(value)) throw new TypeError(`Invalid ${label}.`);
}
function positive(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}
function assertSqlBindings(sql: string, values: readonly unknown[]): void {
	const indexes = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
	const maximum = indexes.length === 0 ? 0 : Math.max(...indexes);
	if (maximum !== values.length || indexes.some((index) => index < 1 || index > values.length))
		throw new TypeError("PostgreSQL control-store placeholder/value mismatch.");
}
