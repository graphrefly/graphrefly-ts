/** Concrete customer-hosted outbound PostgreSQL endpoint binding (D606). */
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type {
	AgentRuntimeAuditRecord,
	ExecutorOutcome,
	SourceRef,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
} from "../orchestration/index.js";

export const CUSTOMER_HOSTED_POSTGRESQL_COMPATIBILITY = "customer-hosted-postgresql-v1" as const;
export const CUSTOMER_HOSTED_POSTGRESQL_PROTOCOL =
	"customer-hosted-postgresql-outbound-wss-v1" as const;
export const CUSTOMER_HOSTED_POSTGRESQL_CONTROL_STORE =
	"postgresql-16-customer-hosted-cas-v1" as const;
export const CUSTOMER_HOSTED_POSTGRESQL_SCHEMA_REVISION =
	"customer-hosted-postgresql-control-v1" as const;
export const CUSTOMER_HOSTED_POSTGRESQL_AGENT_PLATFORM = "linux-amd64-oci-v1" as const;

export interface CustomerHostedPostgresqlRelease {
	readonly kind: "customer-hosted-postgresql-release";
	readonly compatibilityRevision: typeof CUSTOMER_HOSTED_POSTGRESQL_COMPATIBILITY;
	readonly platformRevision: typeof CUSTOMER_HOSTED_POSTGRESQL_AGENT_PLATFORM;
	readonly agentRevision: string;
	readonly agentDigest: `sha256:${string}`;
	readonly signatureIssuerRevision: string;
	readonly signatureRef: SourceRef;
	readonly sbomRef: SourceRef;
	readonly provenanceRef: SourceRef;
}

export interface CustomerHostedPostgresqlEnrollment {
	readonly kind: "customer-hosted-postgresql-enrollment";
	readonly tenantId: string;
	readonly endpointId: string;
	readonly enrollmentRevision: string;
	readonly keyGeneration: number;
	readonly publicKeyFingerprint: `sha256:${string}`;
	readonly agentRevision: string;
	readonly agentDigest: `sha256:${string}`;
	readonly policyRevision: string;
	readonly credentialBindingRevision: string;
	readonly state: "active" | "draining" | "revoked";
	readonly issuedAtMs: number;
	readonly expiresAtMs: number;
	readonly attestationRefs: readonly SourceRef[];
}

export interface CustomerHostedPostgresqlReadiness {
	readonly kind: "customer-hosted-postgresql-readiness";
	readonly tenantId: string;
	readonly endpointId: string;
	readonly enrollmentRevision: string;
	readonly keyGeneration: number;
	readonly agentRevision: string;
	readonly agentDigest: `sha256:${string}`;
	readonly state: "ready" | "stale" | "unavailable";
	readonly observedAtMs: number;
	readonly expiresAtMs: number;
	readonly signatureVerified: boolean;
	readonly sbomVerified: boolean;
	readonly provenanceVerified: boolean;
	readonly serverTrustReady: boolean;
	readonly outboundTlsReady: boolean;
	readonly proxyPolicyReady: boolean;
	readonly firewallPolicyReady: boolean;
	readonly credentialResolverReady: boolean;
	readonly artifactIngressReady: boolean;
	readonly outboxKeyReady: boolean;
	readonly attestationRefs: readonly SourceRef[];
}

export interface CustomerHostedPostgresqlCoordinates {
	readonly tenantId: string;
	readonly endpointId: string;
	readonly enrollmentRevision: string;
	readonly keyGeneration: number;
	readonly agentRevision: string;
	readonly agentDigest: `sha256:${string}`;
	readonly runId: string;
	readonly attempt: number;
	readonly environmentRevision: string;
	readonly deploymentFingerprint: string;
}

export interface CustomerHostedPostgresqlLeaseCoordinates
	extends CustomerHostedPostgresqlCoordinates {
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly sessionEpoch: string;
}

export interface CustomerHostedPostgresqlAdmittedEnvelope
	extends CustomerHostedPostgresqlCoordinates {
	readonly kind: "customer-hosted-postgresql-admitted-envelope";
	readonly protocolRevision: typeof CUSTOMER_HOSTED_POSTGRESQL_PROTOCOL;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId: string;
	readonly admissionId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly adapterInputId: string;
	readonly policyRevision: string;
	readonly credentialBindingRevision: string;
	readonly workloadRef: SourceRef;
	readonly sourceRefs: readonly SourceRef[];
}

export type CustomerHostedPostgresqlAgentMessage =
	| ({
			readonly kind: "claim";
			readonly messageId: string;
			readonly authAttestationRef: SourceRef;
	  } & Pick<
			CustomerHostedPostgresqlCoordinates,
			| "tenantId"
			| "endpointId"
			| "enrollmentRevision"
			| "keyGeneration"
			| "agentRevision"
			| "agentDigest"
	  > & { readonly sessionEpoch: string })
	| ({
			readonly kind: "heartbeat";
			readonly messageId: string;
	  } & CustomerHostedPostgresqlLeaseCoordinates)
	| ({
			readonly kind: "cancel-ack";
			readonly messageId: string;
			readonly cancellationId: string;
	  } & CustomerHostedPostgresqlLeaseCoordinates)
	| ({
			readonly kind: "settle";
			readonly messageId: string;
			readonly settlementId: string;
			readonly outcome: "succeeded" | "failed" | "canceled";
			readonly outcomeRefs: readonly SourceRef[];
			readonly issueRefs: readonly SourceRef[];
	  } & CustomerHostedPostgresqlLeaseCoordinates)
	| ({
			readonly kind: "offline-evidence";
			readonly messageId: string;
			readonly evidence: CustomerHostedPostgresqlOutboxEntry;
	  } & CustomerHostedPostgresqlCoordinates & { readonly sessionEpoch: string });

export type CustomerHostedPostgresqlControlMessage =
	| ({
			readonly kind: "claim-granted";
			readonly messageId: string;
			readonly envelope: CustomerHostedPostgresqlAdmittedEnvelope;
			readonly leaseExpiresAtMs: number;
			readonly heartbeatExpiresAtMs: number;
	  } & CustomerHostedPostgresqlLeaseCoordinates)
	| ({
			readonly kind: "cancel";
			readonly messageId: string;
			readonly cancellationId: string;
	  } & CustomerHostedPostgresqlLeaseCoordinates)
	| ({
			readonly kind: "accepted" | "rejected";
			readonly messageId: string;
			readonly operation: string;
			readonly code?: string;
	  } & Partial<CustomerHostedPostgresqlLeaseCoordinates>);

export interface CustomerHostedPostgresqlLifecycleFact
	extends Partial<CustomerHostedPostgresqlLeaseCoordinates> {
	readonly kind: "customer-hosted-postgresql-lifecycle-fact";
	readonly state:
		| "enrolled"
		| "queued"
		| "claimed"
		| "heartbeat-current"
		| "cancel-pending"
		| "cancel-acknowledged"
		| "settled"
		| "lost"
		| "expired"
		| "revoked"
		| "offline-evidence-accepted"
		| "offline-evidence-rejected";
	readonly occurredAtMs: number;
	readonly code?: string;
}

export interface CustomerHostedPostgresqlCancellationRequested
	extends CustomerHostedPostgresqlLeaseCoordinates {
	readonly kind: "customer-hosted-postgresql-cancellation-requested";
	readonly cancellationId: string;
}

export interface CustomerHostedPostgresqlCancellationPosture {
	readonly kind: "customer-hosted-postgresql-cancellation-posture";
	readonly cancellationId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly state:
		| "persisted-pending"
		| "dispatched-unconfirmed"
		| "acknowledged"
		| "rejected"
		| "lost-unconfirmed";
	readonly code?: string;
}

export interface CustomerHostedPostgresqlStoreResult {
	readonly accepted: boolean;
	readonly code: string;
	readonly lifecycle?: CustomerHostedPostgresqlLifecycleFact;
	readonly lease?: CustomerHostedPostgresqlLeaseCoordinates & {
		readonly envelope: CustomerHostedPostgresqlAdmittedEnvelope;
		readonly leaseExpiresAtMs: number;
		readonly heartbeatExpiresAtMs: number;
	};
	readonly outcome?: ExecutorOutcome;
}

export interface CustomerHostedPostgresqlControlStoreDriver {
	readonly compatibility: typeof CUSTOMER_HOSTED_POSTGRESQL_CONTROL_STORE;
	readonly schemaRevision: typeof CUSTOMER_HOSTED_POSTGRESQL_SCHEMA_REVISION;
	upsertEnrollment(
		enrollment: CustomerHostedPostgresqlEnrollment,
		nowMs: number,
	): Promise<CustomerHostedPostgresqlStoreResult>;
	admit(
		envelope: CustomerHostedPostgresqlAdmittedEnvelope,
		nowMs: number,
	): Promise<CustomerHostedPostgresqlStoreResult>;
	claim(
		message: Extract<CustomerHostedPostgresqlAgentMessage, { kind: "claim" }>,
		enrollment: CustomerHostedPostgresqlEnrollment,
		nowMs: number,
	): Promise<CustomerHostedPostgresqlStoreResult>;
	heartbeat(
		message: Extract<CustomerHostedPostgresqlAgentMessage, { kind: "heartbeat" }>,
		renewToMs: number,
		nowMs: number,
	): Promise<CustomerHostedPostgresqlStoreResult>;
	persistCancellation(
		request: CustomerHostedPostgresqlCancellationRequested,
		nowMs: number,
	): Promise<CustomerHostedPostgresqlStoreResult>;
	acknowledgeCancellation(
		message: Extract<CustomerHostedPostgresqlAgentMessage, { kind: "cancel-ack" }>,
		nowMs: number,
	): Promise<CustomerHostedPostgresqlStoreResult>;
	settle(
		message: Extract<CustomerHostedPostgresqlAgentMessage, { kind: "settle" }>,
		nowMs: number,
	): Promise<CustomerHostedPostgresqlStoreResult>;
	acceptOfflineEvidence(
		message: Extract<CustomerHostedPostgresqlAgentMessage, { kind: "offline-evidence" }>,
		nowMs: number,
	): Promise<CustomerHostedPostgresqlStoreResult>;
	revoke(
		enrollment: CustomerHostedPostgresqlEnrollment,
		nowMs: number,
	): Promise<readonly CustomerHostedPostgresqlLifecycleFact[]>;
	disconnect(
		tenantId: string,
		endpointId: string,
		sessionEpoch: string,
		nowMs: number,
	): Promise<readonly CustomerHostedPostgresqlLifecycleFact[]>;
	expire(nowMs: number): Promise<readonly CustomerHostedPostgresqlLifecycleFact[]>;
	close(): void | Promise<void>;
}

export interface CustomerHostedPostgresqlSqlClient {
	query(
		sql: string,
		params: readonly unknown[],
	): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
	close?(): void | Promise<void>;
}

const CONTROL_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS graphrefly_customer_hosted_v1 (admission_seq bigserial UNIQUE NOT NULL, tenant_id text NOT NULL, endpoint_id text NOT NULL, run_id text NOT NULL, attempt integer NOT NULL, state text NOT NULL, envelope jsonb NOT NULL, enrollment_revision text NOT NULL, key_generation integer NOT NULL, agent_revision text NOT NULL, agent_digest text NOT NULL, policy_revision text NOT NULL, credential_binding_revision text NOT NULL, environment_revision text NOT NULL, deployment_fingerprint text NOT NULL, lease_id text, fencing_token bigint NOT NULL DEFAULT 0, session_epoch text, lease_expires_at_ms bigint, heartbeat_expires_at_ms bigint, cancellation jsonb, outcome jsonb, PRIMARY KEY (tenant_id,endpoint_id,run_id,attempt))`;
const ENROLLMENT_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS graphrefly_customer_endpoint_v1 (tenant_id text NOT NULL, endpoint_id text NOT NULL, enrollment_revision text NOT NULL, key_generation integer NOT NULL, agent_revision text NOT NULL, agent_digest text NOT NULL, state text NOT NULL, expires_at_ms bigint NOT NULL, updated_at_ms bigint NOT NULL, PRIMARY KEY (tenant_id,endpoint_id,key_generation))`;
const ENDPOINT_HEAD_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS graphrefly_customer_endpoint_head_v1 (tenant_id text NOT NULL, endpoint_id text NOT NULL, current_key_generation integer NOT NULL, updated_at_ms bigint NOT NULL, PRIMARY KEY (tenant_id,endpoint_id))`;

/** Concrete PostgreSQL-16 CAS store. Every mutation includes the full cross-domain fence. */
export function postgresql16CustomerHostedControlStore(
	client: CustomerHostedPostgresqlSqlClient,
): CustomerHostedPostgresqlControlStoreDriver {
	const mutate = async (sql: string, params: readonly unknown[]) =>
		storeResult((await client.query(sql, params)).rows[0]);
	const manyLifecycle = async (sql: string, params: readonly unknown[]) =>
		(await client.query(sql, params)).rows.map((row) => {
			const result = storeResult(row);
			if (!result.accepted || result.lifecycle === undefined)
				throw new TypeError("Customer-hosted store omitted terminal lifecycle evidence.");
			return result.lifecycle;
		});
	return {
		compatibility: CUSTOMER_HOSTED_POSTGRESQL_CONTROL_STORE,
		schemaRevision: CUSTOMER_HOSTED_POSTGRESQL_SCHEMA_REVISION,
		async upsertEnrollment(e, now) {
			await client.query(ENDPOINT_HEAD_SCHEMA_SQL, []);
			await client.query(ENROLLMENT_SCHEMA_SQL, []);
			return mutate(
				"WITH authority AS (INSERT INTO graphrefly_customer_endpoint_head_v1 (tenant_id,endpoint_id,current_key_generation,updated_at_ms) VALUES ($1,$2,$4,$9) ON CONFLICT (tenant_id,endpoint_id) DO UPDATE SET current_key_generation=EXCLUDED.current_key_generation,updated_at_ms=EXCLUDED.updated_at_ms WHERE graphrefly_customer_endpoint_head_v1.current_key_generation<=EXCLUDED.current_key_generation RETURNING current_key_generation), written AS (INSERT INTO graphrefly_customer_endpoint_v1 (tenant_id,endpoint_id,enrollment_revision,key_generation,agent_revision,agent_digest,state,expires_at_ms,updated_at_ms) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 FROM authority WHERE current_key_generation=$4 ON CONFLICT (tenant_id,endpoint_id,key_generation) DO UPDATE SET state=EXCLUDED.state,updated_at_ms=EXCLUDED.updated_at_ms WHERE graphrefly_customer_endpoint_v1.enrollment_revision=EXCLUDED.enrollment_revision AND graphrefly_customer_endpoint_v1.agent_revision=EXCLUDED.agent_revision AND graphrefly_customer_endpoint_v1.agent_digest=EXCLUDED.agent_digest AND graphrefly_customer_endpoint_v1.expires_at_ms=EXCLUDED.expires_at_ms AND ((graphrefly_customer_endpoint_v1.state=EXCLUDED.state) OR (graphrefly_customer_endpoint_v1.state='active' AND EXCLUDED.state IN ('draining','revoked')) OR (graphrefly_customer_endpoint_v1.state='draining' AND EXCLUDED.state='revoked')) RETURNING 1) SELECT jsonb_build_object('accepted',true,'code','enrollment-current') AS result FROM written",
				[
					e.tenantId,
					e.endpointId,
					e.enrollmentRevision,
					e.keyGeneration,
					e.agentRevision,
					e.agentDigest,
					e.state,
					e.expiresAtMs,
					now,
				],
			);
		},
		async admit(e, now) {
			await client.query(CONTROL_SCHEMA_SQL, []);
			return mutate(
				"INSERT INTO graphrefly_customer_hosted_v1 (tenant_id,endpoint_id,run_id,attempt,state,envelope,enrollment_revision,key_generation,agent_revision,agent_digest,policy_revision,credential_binding_revision,environment_revision,deployment_fingerprint) VALUES ($1,$2,$3,$4,'queued',$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING jsonb_build_object('accepted',true,'code','queued','lifecycle',jsonb_build_object('kind','customer-hosted-postgresql-lifecycle-fact','state','queued','tenantId',$1,'endpointId',$2,'runId',$3,'attempt',$4,'enrollmentRevision',$6,'keyGeneration',$7,'agentRevision',$8,'agentDigest',$9,'environmentRevision',$12,'deploymentFingerprint',$13,'occurredAtMs',$14)) AS result",
				[
					e.tenantId,
					e.endpointId,
					e.runId,
					e.attempt,
					JSON.stringify(e),
					e.enrollmentRevision,
					e.keyGeneration,
					e.agentRevision,
					e.agentDigest,
					e.policyRevision,
					e.credentialBindingRevision,
					e.environmentRevision,
					e.deploymentFingerprint,
					now,
				],
			);
		},
		claim: (m, _e, now) =>
			mutate(
				`WITH candidate AS (SELECT q.tenant_id,q.endpoint_id,q.run_id,q.attempt FROM graphrefly_customer_endpoint_head_v1 h JOIN graphrefly_customer_endpoint_v1 e ON e.tenant_id=h.tenant_id AND e.endpoint_id=h.endpoint_id AND e.key_generation=h.current_key_generation JOIN graphrefly_customer_hosted_v1 q ON q.tenant_id=e.tenant_id AND q.endpoint_id=e.endpoint_id AND q.key_generation=e.key_generation WHERE q.tenant_id=$4 AND q.endpoint_id=$5 AND q.enrollment_revision=$6 AND q.key_generation=$7 AND q.agent_revision=$8 AND q.agent_digest=$9 AND q.state='queued' AND h.current_key_generation=$7 AND e.enrollment_revision=$6 AND e.agent_revision=$8 AND e.agent_digest=$9 AND e.state='active' AND e.expires_at_ms>$10 ORDER BY q.admission_seq FOR UPDATE OF h,q,e SKIP LOCKED LIMIT 1) UPDATE graphrefly_customer_hosted_v1 q SET state='claimed',lease_id=$1,fencing_token=q.fencing_token+1,session_epoch=$2,lease_expires_at_ms=$3,heartbeat_expires_at_ms=$3 FROM candidate c WHERE q.tenant_id=c.tenant_id AND q.endpoint_id=c.endpoint_id AND q.run_id=c.run_id AND q.attempt=c.attempt RETURNING jsonb_build_object('accepted',true,'code','claimed','lease',${leaseJson("q.")},'lifecycle',${lifecycleJson("claimed", "$10", "q.")}) AS result`,
				[
					`lease:${m.messageId}`,
					m.sessionEpoch,
					now + 30_000,
					m.tenantId,
					m.endpointId,
					m.enrollmentRevision,
					m.keyGeneration,
					m.agentRevision,
					m.agentDigest,
					now,
				],
			),
		heartbeat: (m, renew, now) =>
			mutate(fencedSql("heartbeat_expires_at_ms=$2,lease_expires_at_ms=$2", "heartbeat-current"), [
				null,
				renew,
				...fenceParams(m),
				now,
			]),
		persistCancellation: (m, now) =>
			mutate(fencedSql("cancellation=$1::jsonb", "cancel-pending"), [
				JSON.stringify(m),
				null,
				...fenceParams(m),
				now,
			]),
		acknowledgeCancellation: (m, now) =>
			mutate(
				fencedSql(
					"cancellation=cancellation||'{\"acknowledged\":true}'::jsonb",
					"cancel-acknowledged",
					false,
					"cancellation->>'cancellationId'=$1",
				),
				[m.cancellationId, null, ...fenceParams(m), now],
			),
		settle: (m, now) =>
			mutate(fencedSql(`state='settled',outcome=${canonicalOutcomeSql()}`, "settled", true), [
				JSON.stringify(settlementOutcome(m)),
				null,
				...fenceParams(m),
				now,
			]),
		acceptOfflineEvidence: async (m, now) => {
			const entry = outboxEntry(m.evidence);
			if (!sameCoordinates(entry, m) || entry.occurredAtMs > now)
				return { accepted: false, code: "offline-evidence-coordinate-mismatch" };
			return {
				accepted: true,
				code: "noncanonical-offline-evidence",
				lifecycle: lifecycle("offline-evidence-accepted", now, undefined, m),
			};
		},
		revoke: (e, now) =>
			manyLifecycle(
				`WITH endpoint AS (UPDATE graphrefly_customer_endpoint_v1 SET state='revoked',updated_at_ms=$7 WHERE tenant_id=$1 AND endpoint_id=$2 AND enrollment_revision=$3 AND key_generation=$4 AND agent_revision=$5 AND agent_digest=$6 RETURNING tenant_id), target AS (SELECT q.*,q.state AS prior_state FROM graphrefly_customer_hosted_v1 q,endpoint e WHERE q.tenant_id=$1 AND q.endpoint_id=$2 AND q.enrollment_revision=$3 AND q.key_generation=$4 AND q.agent_revision=$5 AND q.agent_digest=$6 AND q.state IN ('queued','claimed') FOR UPDATE), fenced AS (UPDATE graphrefly_customer_hosted_v1 q SET state='revoked',fencing_token=q.fencing_token+1 FROM target t WHERE q.tenant_id=t.tenant_id AND q.endpoint_id=t.endpoint_id AND q.run_id=t.run_id AND q.attempt=t.attempt RETURNING q.*,t.prior_state) SELECT jsonb_build_object('accepted',true,'code','revoked','lifecycle',${lifecycleJson("revoked", "$7", "fenced.")}) AS result FROM fenced WHERE prior_state='claimed'`,
				[
					e.tenantId,
					e.endpointId,
					e.enrollmentRevision,
					e.keyGeneration,
					e.agentRevision,
					e.agentDigest,
					now,
				],
			),
		async disconnect(tenant, endpoint, epoch, now) {
			return manyLifecycle(
				`UPDATE graphrefly_customer_hosted_v1 SET state='lost',fencing_token=fencing_token+1 WHERE tenant_id=$1 AND endpoint_id=$2 AND session_epoch=$3 AND state='claimed' RETURNING jsonb_build_object('accepted',true,'code','lost','lifecycle',${lifecycleJson("lost", "$4")}) AS result`,
				[tenant, endpoint, epoch, now],
			);
		},
		async expire(now) {
			return manyLifecycle(
				`UPDATE graphrefly_customer_hosted_v1 SET state='expired',fencing_token=fencing_token+1 WHERE state='claimed' AND lease_expires_at_ms <= $1 RETURNING jsonb_build_object('accepted',true,'code','expired','lifecycle',${lifecycleJson("expired", "$1")}) AS result`,
				[now],
			);
		},
		close: () => client.close?.(),
	};
}

function fencedSql(set: string, state: string, includeOutcome = false, extraWhere?: string) {
	return `UPDATE graphrefly_customer_hosted_v1 SET ${set} WHERE tenant_id=$3 AND endpoint_id=$4 AND run_id=$5 AND attempt=$6 AND enrollment_revision=$7 AND key_generation=$8 AND agent_revision=$9 AND agent_digest=$10 AND lease_id=$11 AND fencing_token=$12 AND session_epoch=$13 AND environment_revision=$14 AND deployment_fingerprint=$15 AND state='claimed' AND lease_expires_at_ms>$16${extraWhere ? ` AND ${extraWhere}` : ""} RETURNING jsonb_build_object('accepted',true,'code','${state}','lifecycle',${lifecycleJson(state, "$16")}${includeOutcome ? ",'outcome',outcome" : ""}) AS result`;
}

function leaseJson(prefix = "") {
	return `jsonb_build_object('tenantId',${prefix}tenant_id,'endpointId',${prefix}endpoint_id,'enrollmentRevision',${prefix}enrollment_revision,'keyGeneration',${prefix}key_generation,'agentRevision',${prefix}agent_revision,'agentDigest',${prefix}agent_digest,'runId',${prefix}run_id,'attempt',${prefix}attempt,'environmentRevision',${prefix}environment_revision,'deploymentFingerprint',${prefix}deployment_fingerprint,'leaseId',${prefix}lease_id,'fencingToken',${prefix}fencing_token,'sessionEpoch',${prefix}session_epoch,'envelope',${prefix}envelope,'leaseExpiresAtMs',${prefix}lease_expires_at_ms,'heartbeatExpiresAtMs',${prefix}heartbeat_expires_at_ms)`;
}

function lifecycleJson(state: string, occurredAt: string, prefix = "") {
	return `jsonb_build_object('kind','customer-hosted-postgresql-lifecycle-fact','state','${state}','tenantId',${prefix}tenant_id,'endpointId',${prefix}endpoint_id,'enrollmentRevision',${prefix}enrollment_revision,'keyGeneration',${prefix}key_generation,'agentRevision',${prefix}agent_revision,'agentDigest',${prefix}agent_digest,'runId',${prefix}run_id,'attempt',${prefix}attempt,'environmentRevision',${prefix}environment_revision,'deploymentFingerprint',${prefix}deployment_fingerprint,'leaseId',${prefix}lease_id,'fencingToken',${prefix}fencing_token,'sessionEpoch',${prefix}session_epoch,'occurredAtMs',${occurredAt})`;
}

function canonicalOutcomeSql() {
	return `jsonb_build_object('kind',CASE $1::jsonb->>'outcome' WHEN 'succeeded' THEN 'result' WHEN 'failed' THEN 'failure' ELSE 'canceled' END,'outcomeId',$1::jsonb->>'settlementId','requestId',envelope->>'requestId','operationId',envelope->>'operationId','routeId',envelope->>'routeId','executorId',envelope->>'executorId','profileId',envelope->>'profileId','attempt',attempt,'inputId',envelope->>'adapterInputId','inputKind','tool-call','metadata',jsonb_build_object('runId',run_id,'tenantId',tenant_id,'endpointId',endpoint_id,'enrollmentRevision',enrollment_revision,'keyGeneration',key_generation,'agentRevision',agent_revision,'agentDigest',agent_digest,'leaseId',lease_id,'fencingToken',fencing_token,'sessionEpoch',session_epoch,'issueRefs',$1::jsonb->'issueRefs')) || CASE $1::jsonb->>'outcome' WHEN 'succeeded' THEN jsonb_build_object('result',jsonb_build_object('kind','customer-hosted-result-refs','value',jsonb_build_object('outcomeRefs',$1::jsonb->'outcomeRefs'))) WHEN 'failed' THEN jsonb_build_object('error',jsonb_build_object('code','customer-hosted-worker-failure','message','Customer-hosted worker reported failure.','severity','error'),'retryable',false) ELSE jsonb_build_object('reason','admitted-customer-hosted-cancellation') END`;
}
function fenceParams(m: CustomerHostedPostgresqlLeaseCoordinates) {
	return [
		m.tenantId,
		m.endpointId,
		m.runId,
		m.attempt,
		m.enrollmentRevision,
		m.keyGeneration,
		m.agentRevision,
		m.agentDigest,
		m.leaseId,
		m.fencingToken,
		m.sessionEpoch,
		m.environmentRevision,
		m.deploymentFingerprint,
	];
}

export interface CustomerHostedPostgresqlTrustVerifier {
	verifyServer(revision: string): boolean | Promise<boolean>;
	verifyEnrollment(
		enrollment: CustomerHostedPostgresqlEnrollment,
		release: CustomerHostedPostgresqlRelease,
		authRef: SourceRef,
	): boolean | Promise<boolean>;
}
export interface CustomerHostedPostgresqlTransportDriver {
	readonly protocolRevision: typeof CUSTOMER_HOSTED_POSTGRESQL_PROTOCOL;
	start(
		onMessage: (message: unknown) => void,
		onDisconnect: (tenantId: string, endpointId: string, sessionEpoch: string) => void,
	): void | Promise<void>;
	send(
		tenantId: string,
		endpointId: string,
		sessionEpoch: string,
		message: CustomerHostedPostgresqlControlMessage,
	): void | Promise<void>;
	close(): void | Promise<void>;
}
export interface CustomerHostedPostgresqlOutboundSocket {
	readonly tenantId: string;
	readonly endpointId: string;
	readonly sessionEpoch: string;
	onMessage(cb: (value: unknown) => void): void;
	onClose(cb: () => void): void;
	send(value: unknown): void | Promise<void>;
	close(): void | Promise<void>;
}
export interface CustomerHostedPostgresqlOutboundWssFactory {
	connect():
		| CustomerHostedPostgresqlOutboundSocket
		| Promise<CustomerHostedPostgresqlOutboundSocket>;
}

/** Agent-initiated WSS adapter. URL, proxy, TLS and client-key material remain inside the factory. */
export function authenticatedOutboundCustomerHostedTransport(
	factory: CustomerHostedPostgresqlOutboundWssFactory,
	trust: CustomerHostedPostgresqlTrustVerifier,
	serverRevision: string,
): CustomerHostedPostgresqlTransportDriver {
	let socket: CustomerHostedPostgresqlOutboundSocket | undefined;
	let disconnected = false;
	return {
		protocolRevision: CUSTOMER_HOSTED_POSTGRESQL_PROTOCOL,
		async start(onMessage, onDisconnect) {
			if (!(await trust.verifyServer(serverRevision)))
				throw new TypeError("Customer-hosted server trust rejected.");
			socket = await factory.connect();
			socket.onMessage(onMessage);
			socket.onClose(() => {
				if (!disconnected && socket) {
					disconnected = true;
					onDisconnect(socket.tenantId, socket.endpointId, socket.sessionEpoch);
				}
			});
		},
		async send(t, e, s, m) {
			if (!socket || socket.tenantId !== t || socket.endpointId !== e || socket.sessionEpoch !== s)
				throw new TypeError("No exact current customer-hosted session.");
			await socket.send(snapshot(m));
		},
		async close() {
			if (socket) await socket.close();
			socket = undefined;
		},
	};
}

export interface CustomerHostedPostgresqlWorkerDriver {
	execute(input: {
		readonly workloadRef: SourceRef;
		readonly credentialBindingRevision: string;
		readonly signal: AbortSignal;
	}): Promise<{
		readonly outcome: "succeeded" | "failed" | "canceled";
		readonly outcomeRefs: readonly SourceRef[];
		readonly issueRefs: readonly SourceRef[];
	}>;
	stop(): void | Promise<void>;
	kill(): void | Promise<void>;
	close(): void | Promise<void>;
}

export async function customerHostedPostgresqlWorkerExecute(
	claim: Extract<CustomerHostedPostgresqlControlMessage, { kind: "claim-granted" }>,
	driver: CustomerHostedPostgresqlWorkerDriver,
	settlementId: string,
): Promise<Extract<CustomerHostedPostgresqlAgentMessage, { kind: "settle" }>> {
	validateLease(claim);
	const controller = new AbortController();
	const result = await driver.execute({
		workloadRef: claim.envelope.workloadRef,
		credentialBindingRevision: claim.envelope.credentialBindingRevision,
		signal: controller.signal,
	});
	return snapshot({
		kind: "settle",
		messageId: `settle:${settlementId}`,
		settlementId,
		outcome: result.outcome,
		outcomeRefs: refs(result.outcomeRefs),
		issueRefs: refs(result.issueRefs),
		...coordinates(claim),
	}) as Extract<CustomerHostedPostgresqlAgentMessage, { kind: "settle" }>;
}
export async function stopCustomerHostedWorkerOnDisconnect(
	driver: CustomerHostedPostgresqlWorkerDriver,
): Promise<void> {
	try {
		await driver.stop();
	} finally {
		try {
			await driver.kill();
		} finally {
			await driver.close();
		}
	}
}

export interface CustomerHostedPostgresqlOutboxEntry extends CustomerHostedPostgresqlCoordinates {
	readonly kind: "customer-hosted-postgresql-offline-evidence";
	readonly evidenceId: string;
	readonly terminalPosture: "succeeded" | "failed" | "canceled" | "lost";
	readonly occurredAtMs: number;
	readonly issueRefs: readonly SourceRef[];
	readonly artifactRefs: readonly SourceRef[];
}
export interface CustomerHostedPostgresqlEncryptedOutboxStore {
	readonly encryptionRevision: string;
	encryptionReady(): boolean | Promise<boolean>;
	/** Atomically reject duplicates and capacity overflow across every store client. */
	putEncryptedIfWithinBounds(
		entry: CustomerHostedPostgresqlOutboxEntry,
		maxEntries: number,
		maxBytes: number,
	): "stored" | "duplicate" | "full" | Promise<"stored" | "duplicate" | "full">;
	listEncrypted():
		| readonly CustomerHostedPostgresqlOutboxEntry[]
		| Promise<readonly CustomerHostedPostgresqlOutboxEntry[]>;
	removeEncrypted(evidenceId: string): void | Promise<void>;
	clear(): void | Promise<void>;
}
export interface CustomerHostedPostgresqlOutboxPolicy {
	readonly encryptionRevision: string;
	readonly maxEntries: number;
	readonly maxBytes: number;
	readonly maxAgeMs: number;
}
export type CustomerHostedPostgresqlOutboxLifecycle = {
	readonly kind: "customer-hosted-postgresql-outbox-lifecycle";
	readonly evidenceId: string;
	readonly state: "locally-buffered" | "uploaded" | "rejected" | "expired";
	readonly occurredAtMs: number;
	readonly code?: string;
};

export function customerHostedPostgresqlEvidenceOutbox(
	store: CustomerHostedPostgresqlEncryptedOutboxStore,
	policy: CustomerHostedPostgresqlOutboxPolicy,
	now: () => number = Date.now,
) {
	validatePolicy(policy);
	let tail: Promise<void> = Promise.resolve();
	const exclusive = <T>(work: () => Promise<T>) => {
		const next = tail.then(work, work);
		tail = next.then(
			() => {},
			() => {},
		);
		return next;
	};
	return {
		enqueue(raw: CustomerHostedPostgresqlOutboxEntry) {
			return exclusive(async () => {
				const entry = outboxEntry(raw);
				if (
					store.encryptionRevision !== policy.encryptionRevision ||
					!(await store.encryptionReady())
				)
					throw new TypeError("Customer-hosted evidence outbox encryption is unavailable.");
				if (entry.occurredAtMs > now()) throw new TypeError("Future offline evidence is invalid.");
				const result = await store.putEncryptedIfWithinBounds(
					entry,
					policy.maxEntries,
					policy.maxBytes,
				);
				if (result === "duplicate") throw new TypeError("Duplicate offline evidence is invalid.");
				if (result === "full") throw new RangeError("Customer-hosted evidence outbox is full.");
				if (result !== "stored") throw new TypeError("Invalid encrypted outbox store result.");
				return outboxLifecycle(entry.evidenceId, "locally-buffered", now());
			});
		},
		flush(send: (entry: CustomerHostedPostgresqlOutboxEntry) => Promise<boolean>) {
			return exclusive(async () => {
				if (
					store.encryptionRevision !== policy.encryptionRevision ||
					!(await store.encryptionReady())
				)
					throw new TypeError("Customer-hosted evidence outbox encryption is unavailable.");
				const facts: CustomerHostedPostgresqlOutboxLifecycle[] = [];
				const seen = new Set<string>();
				for (const raw of await store.listEncrypted()) {
					const e = outboxEntry(raw);
					if (seen.has(e.evidenceId)) throw new TypeError("Duplicate encrypted outbox history.");
					seen.add(e.evidenceId);
					if (e.occurredAtMs > now()) throw new TypeError("Future offline evidence is invalid.");
					if (now() - e.occurredAtMs > policy.maxAgeMs) {
						await store.removeEncrypted(e.evidenceId);
						facts.push(outboxLifecycle(e.evidenceId, "expired", now()));
						continue;
					}
					if (await send(e)) {
						await store.removeEncrypted(e.evidenceId);
						facts.push(outboxLifecycle(e.evidenceId, "uploaded", now()));
					} else
						facts.push(
							outboxLifecycle(e.evidenceId, "rejected", now(), "noncanonical-evidence-rejected"),
						);
				}
				return facts;
			});
		},
		dispose: () =>
			exclusive(async () => {
				await store.clear();
			}),
	};
}

export interface CustomerHostedPostgresqlRuntimeOptions {
	readonly name?: string;
	readonly inputs: Node<ToolProviderAdapterInput>;
	readonly approvedRunRequestNodes: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly releaseNodes: readonly Node<CustomerHostedPostgresqlRelease>[];
	readonly enrollmentNodes: readonly Node<CustomerHostedPostgresqlEnrollment>[];
	readonly readinessNodes: readonly Node<CustomerHostedPostgresqlReadiness>[];
	readonly cancellationNodes?: readonly Node<CustomerHostedPostgresqlCancellationRequested>[];
	readonly store: CustomerHostedPostgresqlControlStoreDriver;
	readonly transport: CustomerHostedPostgresqlTransportDriver;
	readonly trust: CustomerHostedPostgresqlTrustVerifier;
	readonly workerDriver: CustomerHostedPostgresqlWorkerDriver;
	readonly now?: () => number;
}
export interface CustomerHostedPostgresqlRuntimeBundle {
	readonly admittedEnvelopes: Node<CustomerHostedPostgresqlAdmittedEnvelope>;
	readonly lifecycle: Node<CustomerHostedPostgresqlLifecycleFact>;
	readonly cancellations: Node<CustomerHostedPostgresqlCancellationPosture>;
	readonly outcomes: Node<ExecutorOutcome>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	expire(): Promise<void>;
	dispose(): Promise<void>;
}

/** Graph-visible cross-domain enrollment/session/cancel/settlement lifecycle. */
export function customerHostedPostgresqlRuntime(
	graph: Graph,
	opts: CustomerHostedPostgresqlRuntimeOptions,
): CustomerHostedPostgresqlRuntimeBundle {
	if (
		opts.store.compatibility !== CUSTOMER_HOSTED_POSTGRESQL_CONTROL_STORE ||
		opts.store.schemaRevision !== CUSTOMER_HOSTED_POSTGRESQL_SCHEMA_REVISION
	)
		throw new TypeError("Customer-hosted control-store mismatch.");
	if (opts.transport.protocolRevision !== CUSTOMER_HOSTED_POSTGRESQL_PROTOCOL)
		throw new TypeError("Customer-hosted protocol mismatch.");
	const now = opts.now ?? Date.now,
		name = opts.name ?? "customerHostedPostgresql",
		group = graph.topologyGroup({ name });
	const node = <T>(suffix: string, factory: string) =>
		group.node<T>([], null, {
			name: `${name}/${suffix}`,
			factory,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		});
	const lifecycleNode = node<CustomerHostedPostgresqlLifecycleFact>(
			"lifecycle",
			"customerHostedPostgresqlLifecycle",
		),
		admittedEnvelopes = node<CustomerHostedPostgresqlAdmittedEnvelope>(
			"admittedEnvelopes",
			"customerHostedPostgresqlAdmittedEnvelopes",
		),
		cancellations = node<CustomerHostedPostgresqlCancellationPosture>(
			"cancellations",
			"customerHostedPostgresqlCancellations",
		),
		outcomes = node<ExecutorOutcome>("outcomes", "customerHostedPostgresqlOutcomes"),
		issues = node<DataIssue>("issues", "customerHostedPostgresqlIssues"),
		audit = node<AgentRuntimeAuditRecord>("audit", "customerHostedPostgresqlAudit");
	let release: CustomerHostedPostgresqlRelease | undefined,
		enrollment: CustomerHostedPostgresqlEnrollment | undefined,
		readiness: CustomerHostedPostgresqlReadiness | undefined,
		disposed = false;
	const active = new Map<string, CustomerHostedPostgresqlLeaseCoordinates>();
	const activeExecutions = new Map<string, Promise<void>>();
	const inputs = new Map<string, ToolProviderAdapterInput>();
	let enrollmentTail: Promise<void> = Promise.resolve();
	const unsubs: (() => void)[] = [];
	const emit = <T>(n: Node<T>, v: T) => n.down([["DATA", v]]);
	const issue = (code: string, message: string) =>
		emit(issues, { code, message, severity: "error" } as DataIssue);
	const emitLife = (f: CustomerHostedPostgresqlLifecycleFact) => {
		const value = snapshot(f);
		emit(lifecycleNode, value);
		emit(audit, {
			id: `customer-hosted:${value.state}:${value.occurredAtMs}`,
			kind: `customer-hosted-${value.state}`,
			subjectId: value.runId ?? value.endpointId ?? "customer-hosted",
			metadata: {
				attempt: value.attempt,
				sessionEpoch: value.sessionEpoch,
				fencingToken: value.fencingToken,
			},
		});
		if (value.runId && value.attempt && ["lost", "expired", "settled"].includes(value.state))
			active.delete(`${value.runId}:${value.attempt}`);
	};
	const run = (p: Promise<void>, code: string) =>
		void p.catch(() => issue(code, "Customer-hosted runtime-private operation failed."));
	for (const n of opts.releaseNodes)
		unsubs.push(
			n.subscribe((m) => {
				if (m[0] === "DATA")
					try {
						release = customerHostedPostgresqlRelease(m[1] as CustomerHostedPostgresqlRelease);
					} catch {
						issue("customer-hosted-release-invalid", "Customer-hosted release is invalid.");
					}
			}),
		);
	for (const n of opts.enrollmentNodes)
		unsubs.push(
			n.subscribe((m) => {
				if (m[0] === "DATA")
					try {
						const next = customerHostedPostgresqlEnrollment(
							m[1] as CustomerHostedPostgresqlEnrollment,
						);
						const work = enrollmentTail.then(async () => {
							const result = validateStoreResult(await opts.store.upsertEnrollment(next, now()));
							if (!result.accepted) throw new TypeError("Enrollment persistence rejected.");
							enrollment = next;
							if (next.state === "revoked") {
								for (const fact of await opts.store.revoke(next, now())) {
									const value = storeLifecycle(fact);
									if (!sameEndpoint(value as EndpointPin, next))
										throw new TypeError("Revocation endpoint mismatch.");
									assertCurrentTerminal(value, active);
									emitLife(value);
								}
								await stopCustomerHostedWorkerOnDisconnect(opts.workerDriver);
							} else {
								emitLife(lifecycle("enrolled", now(), undefined, next));
							}
						});
						enrollmentTail = work.catch(() => {});
						run(
							work,
							next.state === "revoked"
								? "customer-hosted-revoke-failed"
								: "customer-hosted-enrollment-persist-failed",
						);
					} catch {
						issue("customer-hosted-enrollment-invalid", "Customer-hosted enrollment is invalid.");
					}
			}),
		);
	for (const n of opts.readinessNodes)
		unsubs.push(
			n.subscribe((m) => {
				if (m[0] === "DATA")
					try {
						readiness = customerHostedPostgresqlReadiness(
							m[1] as CustomerHostedPostgresqlReadiness,
						);
					} catch {
						issue("customer-hosted-readiness-invalid", "Customer-hosted readiness is invalid.");
					}
			}),
		);
	unsubs.push(
		opts.inputs.subscribe((m) => {
			if (m[0] !== "DATA") return;
			const input = m[1] as ToolProviderAdapterInput;
			if (input.kind === "tool-provider-adapter-input" && typeof input.adapterInputId === "string")
				inputs.set(input.adapterInputId, snapshot(input));
		}),
	);
	for (const n of opts.approvedRunRequestNodes)
		unsubs.push(
			n.subscribe((m) => {
				if (m[0] !== "DATA") return;
				let envelope: CustomerHostedPostgresqlAdmittedEnvelope;
				try {
					const request = m[1] as ToolProviderAdapterRunRequested;
					const input = inputs.get(request.adapterInputId);
					if (!input || !enrollment) throw new TypeError("Missing approved input or enrollment.");
					envelope = customerHostedPostgresqlAdmittedEnvelopeFromApprovedRun(
						request,
						input,
						enrollment,
					);
				} catch {
					issue(
						"customer-hosted-admission-invalid",
						"Customer-hosted admitted envelope is invalid.",
					);
					return;
				}
				run(
					(async () => {
						if (
							!release ||
							!enrollment ||
							!readiness ||
							!ready(release, enrollment, readiness, now())
						) {
							issue(
								"customer-hosted-admission-not-ready",
								"Customer-hosted admission failed closed.",
							);
							return;
						}
						if (!sameEndpoint(envelope, enrollment))
							throw new TypeError("Admission endpoint mismatch.");
						const result = validateStoreResult(await opts.store.admit(envelope, now()));
						if (!result.accepted) {
							issue(result.code, "Customer-hosted admission was rejected.");
							return;
						}
						if (
							!result.lifecycle ||
							result.lifecycle.state !== "queued" ||
							!sameCoordinates(result.lifecycle as CustomerHostedPostgresqlCoordinates, envelope)
						)
							throw new TypeError("Admission store result omitted exact queued lifecycle.");
						emit(admittedEnvelopes, envelope);
						emitLife(result.lifecycle ?? lifecycle("queued", now(), undefined, envelope));
					})(),
					"customer-hosted-admission-failed",
				);
			}),
		);
	for (const n of opts.cancellationNodes ?? [])
		unsubs.push(
			n.subscribe((m) => {
				if (m[0] !== "DATA") return;
				let r: CustomerHostedPostgresqlCancellationRequested;
				try {
					r = customerHostedPostgresqlCancellation(
						m[1] as CustomerHostedPostgresqlCancellationRequested,
					);
				} catch {
					issue("customer-hosted-cancel-invalid", "Customer-hosted cancellation pins are invalid.");
					return;
				}
				run(
					(async () => {
						const current = active.get(`${r.runId}:${r.attempt}`);
						if (!current || !sameLease(current, r)) {
							emit(cancellations, {
								kind: "customer-hosted-postgresql-cancellation-posture",
								cancellationId: r.cancellationId,
								runId: r.runId,
								attempt: r.attempt,
								state: "rejected",
								code: "stale-session",
							});
							return;
						}
						const result = validateStoreResult(await opts.store.persistCancellation(r, now()));
						if (!result.accepted) {
							emit(cancellations, {
								kind: "customer-hosted-postgresql-cancellation-posture",
								cancellationId: r.cancellationId,
								runId: r.runId,
								attempt: r.attempt,
								state: "rejected",
								code: result.code,
							});
							return;
						}
						if (
							!result.lifecycle ||
							result.lifecycle.state !== "cancel-pending" ||
							!sameLease(result.lifecycle as CustomerHostedPostgresqlLeaseCoordinates, r)
						)
							throw new TypeError("Cancellation persistence omitted exact lifecycle.");
						emit(cancellations, {
							kind: "customer-hosted-postgresql-cancellation-posture",
							cancellationId: r.cancellationId,
							runId: r.runId,
							attempt: r.attempt,
							state: "persisted-pending",
						});
						await opts.transport.send(r.tenantId, r.endpointId, r.sessionEpoch, {
							kind: "cancel",
							messageId: `cancel:${r.cancellationId}`,
							cancellationId: r.cancellationId,
							...coordinates(r),
						});
						await opts.workerDriver.stop();
						emit(cancellations, {
							kind: "customer-hosted-postgresql-cancellation-posture",
							cancellationId: r.cancellationId,
							runId: r.runId,
							attempt: r.attempt,
							state: "dispatched-unconfirmed",
						});
					})(),
					"customer-hosted-cancel-failed",
				);
			}),
		);
	const onMessage = (raw: unknown) => {
		if (disposed) return;
		let m: CustomerHostedPostgresqlAgentMessage;
		try {
			m = agentMessage(raw);
		} catch {
			issue("customer-hosted-message-invalid", "Customer-hosted message is invalid.");
			return;
		}
		run(
			(async () => {
				let result: CustomerHostedPostgresqlStoreResult;
				if (m.kind === "claim") {
					if (
						!release ||
						!enrollment ||
						!readiness ||
						!ready(release, enrollment, readiness, now()) ||
						!sameEndpoint(m, enrollment) ||
						!(await opts.trust.verifyEnrollment(enrollment, release, m.authAttestationRef))
					) {
						issue("customer-hosted-not-ready", "Customer-hosted claim failed closed.");
						return;
					}
					result = validateStoreResult(await opts.store.claim(m, enrollment, now()));
					if (result.accepted && !result.lease)
						throw new TypeError("Accepted claim omitted exact lease.");
					if (result.accepted && result.lease) {
						validateLease(result.lease);
						const lease = result.lease;
						if (!sameEndpoint(lease, m) || lease.sessionEpoch !== m.sessionEpoch)
							throw new TypeError("Claim store lease/session mismatch.");
						const key = `${lease.runId}:${lease.attempt}`;
						if (active.has(key)) throw new TypeError("Duplicate active customer execution.");
						active.set(key, lease);
						await opts.transport.send(m.tenantId, m.endpointId, m.sessionEpoch, {
							kind: "claim-granted",
							messageId: m.messageId,
							...lease,
						});
						if (
							!result.lifecycle ||
							result.lifecycle.state !== "claimed" ||
							!sameLease(result.lifecycle as CustomerHostedPostgresqlLeaseCoordinates, lease)
						)
							throw new TypeError("Claim store result omitted exact lifecycle.");
						emitLife(result.lifecycle);
						const execution = (async () => {
							const settlement = await customerHostedPostgresqlWorkerExecute(
								{ kind: "claim-granted", messageId: m.messageId, ...lease },
								opts.workerDriver,
								`driver:${lease.runId}:${lease.attempt}`,
							);
							const accepted = validateStoreResult(await opts.store.settle(settlement, now()));
							if (!accepted.accepted)
								throw new TypeError("Driver-derived settlement CAS rejected.");
							if (
								!accepted.lifecycle ||
								accepted.lifecycle.state !== "settled" ||
								!sameLease(
									accepted.lifecycle as CustomerHostedPostgresqlLeaseCoordinates,
									settlement,
								) ||
								!accepted.outcome
							)
								throw new TypeError("Settlement omitted exact canonical evidence.");
							assertOutcomeForSettlement(accepted.outcome, settlement, lease.envelope);
							if (accepted.lifecycle) emitLife(accepted.lifecycle);
							if (accepted.outcome) emit(outcomes, snapshot(accepted.outcome));
						})().finally(() => activeExecutions.delete(key));
						activeExecutions.set(key, execution);
						run(execution, "customer-hosted-worker-execution-failed");
					}
				} else if (m.kind === "heartbeat")
					result = validateStoreResult(await opts.store.heartbeat(m, now() + 10_000, now()));
				else if (m.kind === "cancel-ack")
					result = validateStoreResult(await opts.store.acknowledgeCancellation(m, now()));
				else if (m.kind === "settle") {
					issue(
						"customer-hosted-direct-settlement-rejected",
						"Only driver-derived settlement is accepted.",
					);
					return;
				} else result = validateStoreResult(await opts.store.acceptOfflineEvidence(m, now()));
				if (!result.accepted) {
					issue(result.code, "Customer-hosted mutation was rejected.");
					return;
				}
				if (
					m.kind === "heartbeat" &&
					(!result.lifecycle ||
						result.lifecycle.state !== "heartbeat-current" ||
						!sameLease(result.lifecycle as CustomerHostedPostgresqlLeaseCoordinates, m))
				)
					throw new TypeError("Heartbeat omitted exact current lifecycle.");
				if (
					m.kind === "cancel-ack" &&
					(!result.lifecycle ||
						result.lifecycle.state !== "cancel-acknowledged" ||
						!sameLease(result.lifecycle as CustomerHostedPostgresqlLeaseCoordinates, m))
				)
					throw new TypeError("Cancellation acknowledgement omitted exact lifecycle.");
				if (
					m.kind === "offline-evidence" &&
					(!result.lifecycle ||
						result.lifecycle.state !== "offline-evidence-accepted" ||
						!sameCoordinates(result.lifecycle as CustomerHostedPostgresqlCoordinates, m))
				)
					throw new TypeError("Offline evidence acknowledgement omitted exact pins.");
				if (result.lifecycle) emitLife(result.lifecycle);
				if (m.kind === "cancel-ack")
					emit(cancellations, {
						kind: "customer-hosted-postgresql-cancellation-posture",
						cancellationId: m.cancellationId,
						runId: m.runId,
						attempt: m.attempt,
						state: "acknowledged",
					});
			})(),
			"customer-hosted-message-failed",
		);
	};
	const onDisconnect = (tenant: string, endpoint: string, epoch: string) =>
		run(
			(async () => {
				for (const raw of await opts.store.disconnect(tenant, endpoint, epoch, now())) {
					const f = storeLifecycle(raw);
					if (
						f.tenantId &&
						(f.tenantId !== tenant || f.endpointId !== endpoint || f.sessionEpoch !== epoch)
					)
						throw new TypeError("Disconnect correlation mismatch.");
					assertCurrentTerminal(f, active);
					emitLife(f);
				}
				await stopCustomerHostedWorkerOnDisconnect(opts.workerDriver);
				for (const value of active.values())
					if (
						value.tenantId === tenant &&
						value.endpointId === endpoint &&
						value.sessionEpoch === epoch
					)
						active.delete(`${value.runId}:${value.attempt}`);
			})(),
			"customer-hosted-disconnect-failed",
		);
	run(
		Promise.resolve(opts.transport.start(onMessage, onDisconnect)).then(() => {}),
		"customer-hosted-transport-failed",
	);
	return {
		admittedEnvelopes,
		lifecycle: lifecycleNode,
		cancellations,
		outcomes,
		issues,
		audit,
		async expire() {
			const facts = (await opts.store.expire(now())).map(storeLifecycle);
			for (const fact of facts) assertCurrentTerminal(fact, active);
			if (facts.length > 0) await stopCustomerHostedWorkerOnDisconnect(opts.workerDriver);
			for (const f of facts) emitLife(f);
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			for (const u of unsubs) u();
			await Promise.resolve(opts.transport.close()).catch(() => {});
			if (active.size > 0)
				await stopCustomerHostedWorkerOnDisconnect(opts.workerDriver).catch(() => {});
			await Promise.race([
				Promise.allSettled(activeExecutions.values()),
				new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
			]);
			await Promise.resolve(opts.store.close()).catch(() => {});
			active.clear();
			inputs.clear();
			group.release({ reason: `${name}:dispose` });
		},
	};
}

export function customerHostedPostgresqlRelease(v: CustomerHostedPostgresqlRelease) {
	exact(v, [
		"kind",
		"compatibilityRevision",
		"platformRevision",
		"agentRevision",
		"agentDigest",
		"signatureIssuerRevision",
		"signatureRef",
		"sbomRef",
		"provenanceRef",
	]);
	if (
		v.kind !== "customer-hosted-postgresql-release" ||
		v.compatibilityRevision !== CUSTOMER_HOSTED_POSTGRESQL_COMPATIBILITY ||
		v.platformRevision !== CUSTOMER_HOSTED_POSTGRESQL_AGENT_PLATFORM
	)
		throw new TypeError("Invalid release.");
	for (const x of [v.agentRevision, v.signatureIssuerRevision]) safe(x);
	digest(v.agentDigest);
	return snapshot({
		...v,
		signatureRef: ref(v.signatureRef),
		sbomRef: ref(v.sbomRef),
		provenanceRef: ref(v.provenanceRef),
	});
}
export function customerHostedPostgresqlEnrollment(v: CustomerHostedPostgresqlEnrollment) {
	exact(v, [
		"kind",
		"tenantId",
		"endpointId",
		"enrollmentRevision",
		"keyGeneration",
		"publicKeyFingerprint",
		"agentRevision",
		"agentDigest",
		"policyRevision",
		"credentialBindingRevision",
		"state",
		"issuedAtMs",
		"expiresAtMs",
		"attestationRefs",
	]);
	if (
		v.kind !== "customer-hosted-postgresql-enrollment" ||
		!["active", "draining", "revoked"].includes(v.state) ||
		!Number.isSafeInteger(v.keyGeneration) ||
		v.keyGeneration < 1 ||
		!Number.isSafeInteger(v.issuedAtMs) ||
		!Number.isSafeInteger(v.expiresAtMs) ||
		v.expiresAtMs <= v.issuedAtMs
	)
		throw new TypeError("Invalid enrollment.");
	for (const x of [
		v.tenantId,
		v.endpointId,
		v.enrollmentRevision,
		v.agentRevision,
		v.policyRevision,
		v.credentialBindingRevision,
	])
		safe(x);
	digest(v.agentDigest);
	digest(v.publicKeyFingerprint);
	return snapshot({ ...v, attestationRefs: refs(v.attestationRefs) });
}
export function customerHostedPostgresqlReadiness(v: CustomerHostedPostgresqlReadiness) {
	exact(v, [
		"kind",
		"tenantId",
		"endpointId",
		"enrollmentRevision",
		"keyGeneration",
		"agentRevision",
		"agentDigest",
		"state",
		"observedAtMs",
		"expiresAtMs",
		"signatureVerified",
		"sbomVerified",
		"provenanceVerified",
		"serverTrustReady",
		"outboundTlsReady",
		"proxyPolicyReady",
		"firewallPolicyReady",
		"credentialResolverReady",
		"artifactIngressReady",
		"outboxKeyReady",
		"attestationRefs",
	]);
	if (
		v.kind !== "customer-hosted-postgresql-readiness" ||
		!["ready", "stale", "unavailable"].includes(v.state) ||
		v.expiresAtMs <= v.observedAtMs
	)
		throw new TypeError("Invalid readiness.");
	for (const x of [v.tenantId, v.endpointId, v.enrollmentRevision, v.agentRevision]) safe(x);
	digest(v.agentDigest);
	return snapshot({ ...v, attestationRefs: refs(v.attestationRefs) });
}
export function customerHostedPostgresqlCancellation(
	v: CustomerHostedPostgresqlCancellationRequested,
) {
	if (v.kind !== "customer-hosted-postgresql-cancellation-requested")
		throw new TypeError("Invalid cancellation.");
	validateLease(v);
	safe(v.cancellationId);
	return snapshot(v);
}

/** Builds a queue envelope only from D419's approved request plus its exact ready input. */
export function customerHostedPostgresqlAdmittedEnvelopeFromApprovedRun(
	request: ToolProviderAdapterRunRequested,
	input: ToolProviderAdapterInput,
	enrollment: CustomerHostedPostgresqlEnrollment,
) {
	if (
		request.kind !== "tool-provider-adapter-run-requested" ||
		input.kind !== "tool-provider-adapter-input" ||
		input.status !== "ready" ||
		request.adapterInputId !== input.adapterInputId ||
		request.requestId !== input.requestId ||
		request.operationId !== input.operationId ||
		request.routeId !== input.routeId ||
		request.executorId !== input.executorId ||
		request.profileId !== input.profileId ||
		input.toolName !== "postgresql.query"
	)
		throw new TypeError("Approved request/input mismatch.");
	const admission = request.sourceRefs?.find((v) => v.kind === "tool-provider-run-admission");
	const workload = input.sourceRefs?.find((v) => v.kind === "customer-hosted-workload");
	const metadata = request.metadata as Record<string, unknown> | undefined;
	if (
		!admission ||
		!workload ||
		metadata?.executionEnvironmentLocality !== "customer-hosted" ||
		metadata.executionEnvironmentBindingKind !== "remote-session"
	)
		throw new TypeError("Approved request lacks customer-hosted admission evidence.");
	const v: CustomerHostedPostgresqlAdmittedEnvelope = {
		kind: "customer-hosted-postgresql-admitted-envelope",
		protocolRevision: CUSTOMER_HOSTED_POSTGRESQL_PROTOCOL,
		tenantId: enrollment.tenantId,
		endpointId: enrollment.endpointId,
		enrollmentRevision: enrollment.enrollmentRevision,
		keyGeneration: enrollment.keyGeneration,
		agentRevision: enrollment.agentRevision,
		agentDigest: enrollment.agentDigest,
		runId: request.runId,
		attempt: request.attempt,
		environmentRevision: String(metadata.executionEnvironmentRevision ?? ""),
		deploymentFingerprint: String(metadata.executionManifestFingerprint ?? ""),
		requestId: request.requestId,
		operationId: request.operationId,
		routeId: request.routeId ?? "",
		admissionId: admission.id,
		executorId: request.executorId ?? "",
		profileId: request.profileId ?? "",
		adapterInputId: request.adapterInputId,
		policyRevision: enrollment.policyRevision,
		credentialBindingRevision: enrollment.credentialBindingRevision,
		workloadRef: workload,
		sourceRefs: refs([...(request.sourceRefs ?? []), ...(input.sourceRefs ?? [])]),
	};
	return admittedEnvelope(v);
}

function admittedEnvelope(v: CustomerHostedPostgresqlAdmittedEnvelope) {
	if (
		v.kind !== "customer-hosted-postgresql-admitted-envelope" ||
		v.protocolRevision !== CUSTOMER_HOSTED_POSTGRESQL_PROTOCOL
	)
		throw new TypeError("Invalid admitted envelope.");
	for (const value of [
		v.requestId,
		v.operationId,
		v.routeId,
		v.admissionId,
		v.executorId,
		v.profileId,
		v.adapterInputId,
		v.policyRevision,
		v.credentialBindingRevision,
	])
		safe(value);
	validateCoordinates(v);
	return snapshot({ ...v, workloadRef: ref(v.workloadRef), sourceRefs: refs(v.sourceRefs) });
}

type EndpointPin = Pick<
	CustomerHostedPostgresqlCoordinates,
	| "tenantId"
	| "endpointId"
	| "enrollmentRevision"
	| "keyGeneration"
	| "agentRevision"
	| "agentDigest"
>;
function sameEndpoint(a: EndpointPin, b: EndpointPin) {
	return (
		a.tenantId === b.tenantId &&
		a.endpointId === b.endpointId &&
		a.enrollmentRevision === b.enrollmentRevision &&
		a.keyGeneration === b.keyGeneration &&
		a.agentRevision === b.agentRevision &&
		a.agentDigest === b.agentDigest
	);
}

function settlementOutcome(m: Extract<CustomerHostedPostgresqlAgentMessage, { kind: "settle" }>) {
	return snapshot({
		settlementId: m.settlementId,
		outcome: m.outcome,
		outcomeRefs: refs(m.outcomeRefs),
		issueRefs: refs(m.issueRefs),
	});
}

function validateCoordinates(v: CustomerHostedPostgresqlCoordinates) {
	for (const x of [
		v.tenantId,
		v.endpointId,
		v.enrollmentRevision,
		v.agentRevision,
		v.runId,
		v.environmentRevision,
		v.deploymentFingerprint,
	])
		safe(x);
	digest(v.agentDigest);
	for (const n of [v.keyGeneration, v.attempt])
		if (!Number.isSafeInteger(n) || n < 1) throw new TypeError("Invalid exact coordinates.");
}

function ready(
	r: CustomerHostedPostgresqlRelease,
	e: CustomerHostedPostgresqlEnrollment,
	p: CustomerHostedPostgresqlReadiness,
	now: number,
) {
	return (
		e.state === "active" &&
		p.state === "ready" &&
		now < e.expiresAtMs &&
		now < p.expiresAtMs &&
		r.agentRevision === e.agentRevision &&
		r.agentDigest === e.agentDigest &&
		[
			e.tenantId,
			e.endpointId,
			e.enrollmentRevision,
			e.agentRevision,
			e.agentDigest,
			e.keyGeneration,
		].every(
			(x, i) =>
				x ===
				[
					p.tenantId,
					p.endpointId,
					p.enrollmentRevision,
					p.agentRevision,
					p.agentDigest,
					p.keyGeneration,
				][i],
		) &&
		[
			p.signatureVerified,
			p.sbomVerified,
			p.provenanceVerified,
			p.serverTrustReady,
			p.outboundTlsReady,
			p.proxyPolicyReady,
			p.firewallPolicyReady,
			p.credentialResolverReady,
			p.artifactIngressReady,
			p.outboxKeyReady,
		].every(Boolean)
	);
}
function agentMessage(v: unknown) {
	if (
		!v ||
		typeof v !== "object" ||
		Array.isArray(v) ||
		Object.getPrototypeOf(v) !== Object.prototype
	)
		throw new TypeError("Invalid message.");
	const raw = v as Record<string, unknown>;
	if (
		!["claim", "heartbeat", "cancel-ack", "settle", "offline-evidence"].includes(String(raw.kind))
	)
		throw new TypeError("Invalid message.");
	const coordinateKeys = [
		"tenantId",
		"endpointId",
		"enrollmentRevision",
		"keyGeneration",
		"agentRevision",
		"agentDigest",
		"runId",
		"attempt",
		"environmentRevision",
		"deploymentFingerprint",
	];
	const leaseKeys = [...coordinateKeys, "leaseId", "fencingToken", "sessionEpoch"];
	const expected =
		raw.kind === "claim"
			? [
					"kind",
					"messageId",
					"tenantId",
					"endpointId",
					"enrollmentRevision",
					"keyGeneration",
					"agentRevision",
					"agentDigest",
					"sessionEpoch",
					"authAttestationRef",
				]
			: raw.kind === "heartbeat"
				? ["kind", "messageId", ...leaseKeys]
				: raw.kind === "cancel-ack"
					? ["kind", "messageId", "cancellationId", ...leaseKeys]
					: raw.kind === "settle"
						? [
								"kind",
								"messageId",
								"settlementId",
								"outcome",
								"outcomeRefs",
								"issueRefs",
								...leaseKeys,
							]
						: ["kind", "messageId", "evidence", ...coordinateKeys, "sessionEpoch"];
	exact(raw, expected);
	const x = snapshot(raw) as unknown as CustomerHostedPostgresqlAgentMessage;
	if (x.kind === "claim") {
		for (const y of [
			x.tenantId,
			x.endpointId,
			x.enrollmentRevision,
			x.agentRevision,
			x.sessionEpoch,
			x.messageId,
		])
			safe(y);
		digest(x.agentDigest);
		if (!Number.isSafeInteger(x.keyGeneration) || x.keyGeneration < 1)
			throw new TypeError("Invalid key generation.");
		ref(x.authAttestationRef);
	} else if (x.kind === "offline-evidence") {
		validateCoordinates(x);
		if (!sameCoordinates(x, x.evidence)) throw new TypeError("Offline evidence pins mismatch.");
		outboxEntry(x.evidence);
	} else validateLease(x);
	return x;
}
function validateLease(v: CustomerHostedPostgresqlLeaseCoordinates) {
	validateCoordinates(v);
	for (const x of [v.leaseId, v.sessionEpoch]) safe(x);
	for (const n of [v.fencingToken])
		if (!Number.isSafeInteger(n) || n < 1) throw new TypeError("Invalid exact fence.");
}
function sameLease(
	a: CustomerHostedPostgresqlLeaseCoordinates,
	b: CustomerHostedPostgresqlLeaseCoordinates,
) {
	return JSON.stringify(coordinates(a)) === JSON.stringify(coordinates(b));
}
function sameCoordinates(
	a: CustomerHostedPostgresqlCoordinates,
	b: CustomerHostedPostgresqlCoordinates,
) {
	return [
		"tenantId",
		"endpointId",
		"enrollmentRevision",
		"keyGeneration",
		"agentRevision",
		"agentDigest",
		"runId",
		"attempt",
		"environmentRevision",
		"deploymentFingerprint",
	].every(
		(key) =>
			(a as unknown as Record<string, unknown>)[key] ===
			(b as unknown as Record<string, unknown>)[key],
	);
}
function assertCurrentTerminal(
	fact: CustomerHostedPostgresqlLifecycleFact,
	active: ReadonlyMap<string, CustomerHostedPostgresqlLeaseCoordinates>,
) {
	if (!fact.runId || !fact.attempt)
		throw new TypeError("Terminal lifecycle lacks run coordinates.");
	const current = active.get(`${fact.runId}:${fact.attempt}`);
	if (
		!current ||
		!sameCoordinates(current, fact as CustomerHostedPostgresqlCoordinates) ||
		current.leaseId !== fact.leaseId ||
		current.sessionEpoch !== fact.sessionEpoch ||
		!Number.isSafeInteger(fact.fencingToken) ||
		fact.fencingToken !== current.fencingToken + 1
	)
		throw new TypeError("Terminal lifecycle does not fence the current active lease.");
}
function coordinates(
	v: CustomerHostedPostgresqlLeaseCoordinates,
): CustomerHostedPostgresqlLeaseCoordinates {
	return {
		tenantId: v.tenantId,
		endpointId: v.endpointId,
		enrollmentRevision: v.enrollmentRevision,
		keyGeneration: v.keyGeneration,
		agentRevision: v.agentRevision,
		agentDigest: v.agentDigest,
		runId: v.runId,
		attempt: v.attempt,
		environmentRevision: v.environmentRevision,
		deploymentFingerprint: v.deploymentFingerprint,
		leaseId: v.leaseId,
		fencingToken: v.fencingToken,
		sessionEpoch: v.sessionEpoch,
	};
}
function lifecycle(
	state: CustomerHostedPostgresqlLifecycleFact["state"],
	occurredAtMs: number,
	code?: string,
	c?: Partial<CustomerHostedPostgresqlLeaseCoordinates>,
): CustomerHostedPostgresqlLifecycleFact {
	return snapshot({
		...c,
		kind: "customer-hosted-postgresql-lifecycle-fact",
		state,
		occurredAtMs,
		...(code ? { code } : {}),
	});
}
function outboxEntry(v: CustomerHostedPostgresqlOutboxEntry) {
	exact(v, [
		"kind",
		"evidenceId",
		"terminalPosture",
		"occurredAtMs",
		"issueRefs",
		"artifactRefs",
		"tenantId",
		"endpointId",
		"enrollmentRevision",
		"keyGeneration",
		"agentRevision",
		"agentDigest",
		"runId",
		"attempt",
		"environmentRevision",
		"deploymentFingerprint",
	]);
	if (v.kind !== "customer-hosted-postgresql-offline-evidence")
		throw new TypeError("Invalid outbox evidence.");
	validateCoordinates(v);
	for (const x of [v.evidenceId, v.runId]) safe(x);
	if (
		!["succeeded", "failed", "canceled", "lost"].includes(v.terminalPosture) ||
		!Number.isSafeInteger(v.occurredAtMs)
	)
		throw new TypeError("Invalid outbox evidence.");
	return Object.freeze({
		kind: v.kind,
		evidenceId: v.evidenceId,
		terminalPosture: v.terminalPosture,
		occurredAtMs: v.occurredAtMs,
		issueRefs: refs(v.issueRefs),
		artifactRefs: refs(v.artifactRefs),
		tenantId: v.tenantId,
		endpointId: v.endpointId,
		enrollmentRevision: v.enrollmentRevision,
		keyGeneration: v.keyGeneration,
		agentRevision: v.agentRevision,
		agentDigest: v.agentDigest,
		runId: v.runId,
		attempt: v.attempt,
		environmentRevision: v.environmentRevision,
		deploymentFingerprint: v.deploymentFingerprint,
	});
}
function outboxLifecycle(
	evidenceId: string,
	state: CustomerHostedPostgresqlOutboxLifecycle["state"],
	occurredAtMs: number,
	code?: string,
): CustomerHostedPostgresqlOutboxLifecycle {
	return Object.freeze({
		kind: "customer-hosted-postgresql-outbox-lifecycle",
		evidenceId,
		state,
		occurredAtMs,
		...(code ? { code } : {}),
	});
}
function validatePolicy(p: CustomerHostedPostgresqlOutboxPolicy) {
	safe(p.encryptionRevision);
	for (const n of [p.maxEntries, p.maxBytes, p.maxAgeMs])
		if (!Number.isSafeInteger(n) || n < 1) throw new RangeError("Invalid outbox policy.");
	if (
		p.maxEntries > 1_000 ||
		p.maxBytes > 16 * 1024 * 1024 ||
		p.maxAgeMs > 7 * 24 * 60 * 60 * 1_000
	)
		throw new RangeError("Outbox policy exceeds the D606 bound.");
}
function storeResult(
	row: Record<string, unknown> | undefined,
): CustomerHostedPostgresqlStoreResult {
	if (!row) return { accepted: false, code: "cas-rejected" };
	const v = row.result;
	if (!v || typeof v !== "object") throw new TypeError("Invalid customer-hosted store result.");
	const x = v as Record<string, unknown>;
	if (
		!exactOptional(x, ["accepted", "code"], ["lifecycle", "lease", "outcome"]) ||
		typeof x.accepted !== "boolean" ||
		typeof x.code !== "string"
	)
		throw new TypeError("Invalid customer-hosted store result.");
	safe(x.code);
	const lifecycleValue = x.lifecycle === undefined ? undefined : storeLifecycle(x.lifecycle);
	const leaseValue = x.lease === undefined ? undefined : storeLease(x.lease);
	const outcomeValue = x.outcome === undefined ? undefined : storeOutcome(x.outcome);
	if (!x.accepted && (lifecycleValue || leaseValue || outcomeValue))
		throw new TypeError("Rejected store result carried authoritative material.");
	return Object.freeze({
		accepted: x.accepted,
		code: x.code,
		...(lifecycleValue ? { lifecycle: lifecycleValue } : {}),
		...(leaseValue ? { lease: leaseValue } : {}),
		...(outcomeValue ? { outcome: outcomeValue } : {}),
	});
}

function validateStoreResult(value: CustomerHostedPostgresqlStoreResult) {
	return storeResult({ result: value });
}

function storeLifecycle(raw: unknown): CustomerHostedPostgresqlLifecycleFact {
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new TypeError("Invalid store lifecycle.");
	const record = raw as Record<string, unknown>;
	if (
		!exactOptional(
			record,
			["kind", "state", "occurredAtMs"],
			[
				"tenantId",
				"endpointId",
				"enrollmentRevision",
				"keyGeneration",
				"agentRevision",
				"agentDigest",
				"runId",
				"attempt",
				"environmentRevision",
				"deploymentFingerprint",
				"leaseId",
				"fencingToken",
				"sessionEpoch",
				"code",
			],
		)
	)
		throw new TypeError("Invalid store lifecycle fields.");
	const value = snapshot(record) as unknown as CustomerHostedPostgresqlLifecycleFact;
	if (
		value.kind !== "customer-hosted-postgresql-lifecycle-fact" ||
		![
			"enrolled",
			"queued",
			"claimed",
			"heartbeat-current",
			"cancel-pending",
			"cancel-acknowledged",
			"settled",
			"lost",
			"expired",
			"revoked",
			"offline-evidence-accepted",
			"offline-evidence-rejected",
		].includes(value.state) ||
		!Number.isSafeInteger(value.occurredAtMs)
	)
		throw new TypeError("Invalid store lifecycle.");
	if (
		!["enrolled", "offline-evidence-accepted", "offline-evidence-rejected"].includes(value.state)
	) {
		validateCoordinates(value as CustomerHostedPostgresqlCoordinates);
		if (
			[
				"claimed",
				"heartbeat-current",
				"cancel-pending",
				"cancel-acknowledged",
				"settled",
				"lost",
				"expired",
				"revoked",
			].includes(value.state)
		)
			validateLease(value as CustomerHostedPostgresqlLeaseCoordinates);
	}
	return value;
}

function storeLease(raw: unknown): NonNullable<CustomerHostedPostgresqlStoreResult["lease"]> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new TypeError("Invalid store lease.");
	exact(raw as object, [
		"tenantId",
		"endpointId",
		"enrollmentRevision",
		"keyGeneration",
		"agentRevision",
		"agentDigest",
		"runId",
		"attempt",
		"environmentRevision",
		"deploymentFingerprint",
		"leaseId",
		"fencingToken",
		"sessionEpoch",
		"envelope",
		"leaseExpiresAtMs",
		"heartbeatExpiresAtMs",
	]);
	const value = snapshot(raw) as NonNullable<CustomerHostedPostgresqlStoreResult["lease"]>;
	validateLease(value);
	if (
		!Number.isSafeInteger(value.leaseExpiresAtMs) ||
		!Number.isSafeInteger(value.heartbeatExpiresAtMs) ||
		value.heartbeatExpiresAtMs > value.leaseExpiresAtMs
	)
		throw new TypeError("Invalid store lease expiry.");
	const envelope = admittedEnvelope(value.envelope);
	if (!sameLeaseEnvelope(value, envelope))
		throw new TypeError("Store lease/envelope correlation mismatch.");
	return Object.freeze({
		...coordinates(value),
		envelope,
		leaseExpiresAtMs: value.leaseExpiresAtMs,
		heartbeatExpiresAtMs: value.heartbeatExpiresAtMs,
	});
}

function storeOutcome(raw: unknown): ExecutorOutcome {
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new TypeError("Invalid store outcome.");
	const record = raw as Record<string, unknown>;
	const common = [
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
	];
	const kind = record.kind;
	if (kind === "result") exact(record, [...common, "result"]);
	else if (kind === "failure") exact(record, [...common, "error", "retryable"]);
	else if (kind === "canceled") exact(record, [...common, "reason"]);
	else throw new TypeError("Invalid store outcome kind.");
	const value = snapshot(record) as unknown as ExecutorOutcome;
	if (
		/(password|secret|credentialvalue|connectionstring|privatekey|rawsql|signedurl|clienthandle|socket)/i.test(
			JSON.stringify(value),
		)
	)
		throw new TypeError("Runtime-private outcome material rejected.");
	if (
		typeof value.outcomeId !== "string" ||
		!Number.isSafeInteger(value.attempt) ||
		value.attempt < 1 ||
		value.inputKind !== "tool-call"
	)
		throw new TypeError("Invalid store outcome.");
	for (const id of [
		value.outcomeId,
		value.requestId,
		value.operationId,
		value.routeId,
		value.executorId,
		value.profileId,
		value.inputId,
	])
		safe(id);
	if (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata))
		throw new TypeError("Invalid store outcome metadata.");
	exact(value.metadata, [
		"runId",
		"tenantId",
		"endpointId",
		"enrollmentRevision",
		"keyGeneration",
		"agentRevision",
		"agentDigest",
		"leaseId",
		"fencingToken",
		"sessionEpoch",
		"issueRefs",
	]);
	const metadata = value.metadata as Record<string, unknown>;
	for (const id of [
		metadata.runId,
		metadata.tenantId,
		metadata.endpointId,
		metadata.enrollmentRevision,
		metadata.agentRevision,
		metadata.leaseId,
		metadata.sessionEpoch,
	])
		safe(id);
	digest(metadata.agentDigest);
	for (const n of [metadata.keyGeneration, metadata.fencingToken])
		if (!Number.isSafeInteger(n) || Number(n) < 1) throw new TypeError("Invalid outcome fence.");
	refs(metadata.issueRefs as readonly SourceRef[]);
	if (value.kind === "result") {
		exact(value.result, ["kind", "value"]);
		if (
			value.result.kind !== "customer-hosted-result-refs" ||
			!value.result.value ||
			typeof value.result.value !== "object" ||
			Array.isArray(value.result.value)
		)
			throw new TypeError("Invalid result refs.");
		exact(value.result.value as object, ["outcomeRefs"]);
		refs((value.result.value as { outcomeRefs: readonly SourceRef[] }).outcomeRefs);
	} else if (value.kind === "failure") {
		exact(value.error, ["code", "message", "severity"]);
		if (value.retryable !== false || value.error.severity !== "error")
			throw new TypeError("Invalid failure outcome.");
		safe(value.error.code);
		safe(value.error.message);
	} else if (value.kind !== "canceled" || value.reason !== "admitted-customer-hosted-cancellation")
		throw new TypeError("Invalid cancellation outcome.");
	return value;
}

function assertOutcomeForSettlement(
	outcome: ExecutorOutcome,
	message: Extract<CustomerHostedPostgresqlAgentMessage, { kind: "settle" }>,
	envelope: CustomerHostedPostgresqlAdmittedEnvelope,
) {
	if (
		outcome.outcomeId !== message.settlementId ||
		outcome.requestId !== envelope.requestId ||
		outcome.operationId !== envelope.operationId ||
		outcome.routeId !== envelope.routeId ||
		outcome.executorId !== envelope.executorId ||
		outcome.profileId !== envelope.profileId ||
		outcome.attempt !== message.attempt ||
		outcome.inputId !== envelope.adapterInputId
	)
		throw new TypeError("Canonical outcome request correlation mismatch.");
	const metadata = outcome.metadata as Record<string, unknown>;
	const expected = { ...coordinates(message), issueRefs: message.issueRefs };
	for (const key of [
		"runId",
		"tenantId",
		"endpointId",
		"enrollmentRevision",
		"keyGeneration",
		"agentRevision",
		"agentDigest",
		"leaseId",
		"fencingToken",
		"sessionEpoch",
	])
		if (metadata[key] !== (expected as Record<string, unknown>)[key])
			throw new TypeError("Canonical outcome fence correlation mismatch.");
	if (JSON.stringify(metadata.issueRefs) !== JSON.stringify(refs(message.issueRefs)))
		throw new TypeError("Canonical issue refs mismatch.");
	if (
		(message.outcome === "succeeded") !== (outcome.kind === "result") ||
		(message.outcome === "failed") !== (outcome.kind === "failure") ||
		(message.outcome === "canceled") !== (outcome.kind === "canceled")
	)
		throw new TypeError("Canonical outcome kind mismatch.");
	if (
		outcome.kind === "result" &&
		JSON.stringify((outcome.result.value as { outcomeRefs: readonly SourceRef[] }).outcomeRefs) !==
			JSON.stringify(refs(message.outcomeRefs))
	)
		throw new TypeError("Canonical outcome refs mismatch.");
}

function sameLeaseEnvelope(
	a: CustomerHostedPostgresqlLeaseCoordinates,
	b: CustomerHostedPostgresqlAdmittedEnvelope,
) {
	return [
		"tenantId",
		"endpointId",
		"enrollmentRevision",
		"keyGeneration",
		"agentRevision",
		"agentDigest",
		"runId",
		"attempt",
		"environmentRevision",
		"deploymentFingerprint",
	].every(
		(key) =>
			(a as unknown as Record<string, unknown>)[key] ===
			(b as unknown as Record<string, unknown>)[key],
	);
}

function exactOptional(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[],
) {
	return (
		required.every((key) => Object.hasOwn(value, key)) &&
		Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
	);
}
function ref(v: SourceRef) {
	if (!v || typeof v !== "object" || Array.isArray(v)) throw new TypeError("Invalid source ref.");
	const x = v as unknown as Record<string, unknown>;
	if (typeof x.kind !== "string" || typeof x.id !== "string")
		throw new TypeError("Invalid source ref.");
	safe(x.kind);
	safe(x.id);
	return snapshot(v);
}
function refs(v: readonly SourceRef[]) {
	if (!Array.isArray(v) || v.length > 32) throw new TypeError("Invalid source refs.");
	return Object.freeze(v.map(ref));
}
function digest(v: unknown): asserts v is `sha256:${string}` {
	if (typeof v !== "string" || !/^sha256:[a-f0-9]{64}$/.test(v))
		throw new TypeError("Invalid digest.");
}
function safe(v: unknown) {
	if (
		typeof v !== "string" ||
		v.length < 1 ||
		v.length > 255 ||
		[...v].some((c) => {
			const n = c.charCodeAt(0);
			return n < 32 || n === 127;
		})
	)
		throw new TypeError("Invalid bounded identifier.");
}
function exact(v: object, keys: readonly string[]) {
	const actual = Object.keys(v).sort(),
		expected = [...keys].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		throw new TypeError("Unexpected fields.");
}
function snapshot<T>(v: T): T {
	if (v === null || typeof v !== "object") return v;
	if (Array.isArray(v)) {
		if (v.length > 128) throw new TypeError("Array exceeds bound.");
		return Object.freeze(v.map(snapshot)) as T;
	}
	const o = v as Record<string, unknown>;
	if (Object.getPrototypeOf(o) !== Object.prototype)
		throw new TypeError("Non-plain material rejected.");
	if (Object.keys(o).length > 64) throw new TypeError("Object exceeds bound.");
	const out: Record<string, unknown> = {};
	for (const [k, x] of Object.entries(o)) {
		if (
			/(secret|password|connection|string|proxyurl|signedurl|client|socket|handle|rawsql|privatekey|credentialvalue)/i.test(
				k,
			)
		)
			throw new TypeError("Runtime-private material rejected.");
		out[k] = snapshot(x);
	}
	return Object.freeze(out) as T;
}
