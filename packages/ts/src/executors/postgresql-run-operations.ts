/** Governed PostgreSQL production-run operations (D607). Package root intentionally closed. */
import type { SourceRef, ToolProviderAdapterRunRequested } from "../orchestration/index.js";
import type { WorkItemDomainActionProposal } from "../solutions/work-item/actions.js";

export const POSTGRESQL_RUN_OPERATIONS_COMPATIBILITY = "postgresql-run-operations-v1" as const;
export const POSTGRESQL_RUN_OPERATIONS_SCHEMA = "graphrefly_postgresql_run_operations_v1" as const;

export type PostgresqlRunOperationAction =
	| "retry"
	| "rerun"
	| "replay"
	| "backfill"
	| "repair"
	| "cancel"
	| "resume"
	| "rollback";

export interface PostgresqlRunTarget {
	readonly tenantId: string;
	readonly workspaceId: string;
	readonly requestId: string;
	readonly adapterInputId: string;
	readonly operationId: string;
	readonly workItemId: string;
	readonly routeId: string;
	readonly admissionId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly environmentRevision: string;
	readonly environmentId: string;
	readonly environmentLocality: "local" | "managed-cloud" | "customer-hosted";
	readonly environmentBindingKind: "local-host-process" | "local-container" | "remote-session";
	readonly executionSessionEpoch: string;
	readonly deploymentFingerprint: string;
	readonly queryRevision: string;
	readonly specRevision: string;
	readonly inputRevision: string;
	readonly sourceRevision: string;
	readonly schemaRevision: string;
	readonly artifactRevision: string;
	readonly retentionRevision: string;
	readonly policyRevision: string;
	readonly terminalHighWater: number;
}

export interface PostgresqlRetainedWindow {
	readonly snapshotRef: SourceRef;
	readonly snapshotRevision: string;
	readonly windowStart: string;
	readonly windowEnd: string;
	readonly dedupeKey: string;
	readonly retentionRevision: string;
	readonly retainedUntilMs: number;
}

export interface PostgresqlRunOperationRequest {
	readonly kind: "postgresql-run-operation-request";
	readonly recoveryId: string;
	readonly intentId: string;
	readonly idempotencyKey: string;
	readonly action: PostgresqlRunOperationAction;
	readonly actorId: string;
	readonly capabilityRevision: string;
	readonly target: PostgresqlRunTarget;
	readonly retainedWindow?: PostgresqlRetainedWindow;
	readonly evidenceRefs: readonly SourceRef[];
	readonly requestedAtMs: number;
	readonly expiresAtMs: number;
}

export interface PostgresqlRunCurrentTruth {
	readonly kind: "postgresql-run-current-truth";
	readonly target: PostgresqlRunTarget;
	readonly terminal: boolean;
	readonly occurrenceVerified: boolean;
	readonly inputImmutable: boolean;
	readonly authorized: boolean;
	readonly accessible: boolean;
	readonly retentionVerified: boolean;
	readonly currentAttempt: number;
	readonly terminalHighWater: number;
	readonly observedAtMs: number;
	readonly failureClass:
		| "missing-input"
		| "credential-or-access"
		| "runtime-loss"
		| "timeout"
		| "schema-drift"
		| "partial-output"
		| "stale-evidence"
		| "retention-gap"
		| "unverifiable-occurrence"
		| "verified-failure";
	readonly recoveryPolicyAllowsRetry: boolean;
	readonly authorizedActorId: string;
	readonly currentCapabilityRevision: string;
	readonly currentPolicyRevision: string;
	/** Host-admitted fresh M9/M10 lowering coordinates for rerun/replay/backfill. */
	readonly successorCandidate?: PostgresqlRunSuccessorCandidate;
	readonly retainedWindow?: PostgresqlRetainedWindow;
}

export interface PostgresqlRunSuccessorCandidate {
	readonly adapterInputId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly inputRevision: string;
	readonly queryRevision: string;
	readonly specRevision: string;
	readonly sourceRevision: string;
	readonly schemaRevision: string;
	readonly artifactRevision: string;
	readonly policyRevision: string;
	readonly environmentId: string;
	readonly environmentRevision: string;
	readonly environmentLocality: "local" | "managed-cloud" | "customer-hosted";
	readonly environmentBindingKind: "local-host-process" | "local-container" | "remote-session";
	readonly executionSessionEpoch: string;
	readonly deploymentFingerprint: string;
}

export interface PostgresqlRunOperationAdmission {
	readonly kind: "postgresql-run-operation-admission";
	readonly recoveryId: string;
	readonly state: "admitted" | "denied" | "expired";
	readonly code: string;
	readonly bodyFingerprint: string;
	readonly decidedAtMs: number;
	readonly auditRefs: readonly SourceRef[];
}

export interface PostgresqlRunOperationMaterialization {
	readonly kind: "postgresql-run-operation-materialization";
	readonly recoveryId: string;
	readonly action: Exclude<PostgresqlRunOperationAction, "resume" | "rollback" | "cancel">;
	readonly materializationId: string;
	readonly candidateRequest: ToolProviderAdapterRunRequested | null;
	readonly repairProposal: PostgresqlRepairProposal | null;
	readonly materializedAtMs: number;
}

export interface PostgresqlRepairProposal {
	readonly kind: "postgresql-repair-proposal";
	readonly proposalId: string;
	readonly sourceRecoveryId: string;
	readonly target: PostgresqlRunTarget;
	readonly evidenceRefs: readonly SourceRef[];
}

export interface PostgresqlRepairHandoffResult {
	readonly accepted: boolean;
	readonly code: string;
	readonly proposal?: WorkItemDomainActionProposal<{
		readonly recoveryId: string;
		readonly runId: string;
		readonly outcomeId: string;
	}>;
}
function repairWorkItemProposal(
	value: PostgresqlRepairProposal,
	request: PostgresqlRunOperationRequest,
	nowMs: number,
): NonNullable<PostgresqlRepairHandoffResult["proposal"]> {
	return snapshot({
		kind: "work-item-domain-action-proposal",
		proposalId: value.proposalId,
		workItemId: request.target.workItemId,
		actionKind: "postgresql-governed-repair",
		effectRunId: `recovery:${request.recoveryId}`,
		effectRunResultId: request.target.outcomeId,
		evidenceId: value.evidenceRefs[0]?.id ?? request.target.outcomeId,
		policyId: request.target.policyRevision,
		payload: {
			recoveryId: request.recoveryId,
			runId: request.target.runId,
			outcomeId: request.target.outcomeId,
		},
		reason: "Governed PostgreSQL repair proposal; requires D358 admission and application.",
		sourceRefs: [
			...value.evidenceRefs,
			{ kind: "postgresql-run-recovery", id: request.recoveryId },
		],
		proposedAtMs: nowMs,
	});
}

export interface PostgresqlRunOperationTerminal {
	readonly kind: "postgresql-run-operation-terminal";
	readonly recoveryId: string;
	readonly state: "materialized" | "rejected" | "canceled" | "expired";
	readonly code: string;
	readonly successorRequestId?: string;
	readonly completedAtMs: number;
	readonly auditRefs: readonly SourceRef[];
}

export interface PostgresqlRunOperationStoreResult {
	readonly accepted: boolean;
	readonly code: string;
	readonly request?: PostgresqlRunOperationRequest;
	readonly admission?: PostgresqlRunOperationAdmission;
	readonly materialization?: PostgresqlRunOperationMaterialization;
	readonly terminal?: PostgresqlRunOperationTerminal;
	readonly receipt?: PostgresqlRunOperationMaterializationReceipt;
}
export interface PostgresqlRunOperationMaterializationReceipt {
	readonly kind: "postgresql-run-operation-materialization-receipt";
	readonly recoveryId: string;
	readonly bodyFingerprint: string;
	readonly terminalHighWater: number;
	readonly action: Exclude<PostgresqlRunOperationAction, "resume" | "rollback" | "cancel">;
	readonly materializationId: string;
	readonly admittedAtMs: number;
	readonly materializedAtMs: number;
	readonly materialization: PostgresqlRunOperationMaterialization;
}

export interface PostgresqlRunOperationsStore {
	readonly compatibility: typeof POSTGRESQL_RUN_OPERATIONS_COMPATIBILITY;
	readonly schema: typeof POSTGRESQL_RUN_OPERATIONS_SCHEMA;
	record(request: PostgresqlRunOperationRequest): Promise<PostgresqlRunOperationStoreResult>;
	admit(
		request: PostgresqlRunOperationRequest,
		truth: PostgresqlRunCurrentTruth,
		nowMs: number,
	): Promise<PostgresqlRunOperationStoreResult>;
	materialize(
		request: PostgresqlRunOperationRequest,
		truth: PostgresqlRunCurrentTruth,
		materialization: PostgresqlRunOperationMaterialization,
		nowMs: number,
	): Promise<PostgresqlRunOperationStoreResult>;
	repairProposal(
		request: PostgresqlRunOperationRequest,
		truth: PostgresqlRunCurrentTruth,
		nowMs: number,
	): Promise<PostgresqlRepairHandoffResult>;
	terminate(
		request: PostgresqlRunOperationRequest,
		truth: PostgresqlRunCurrentTruth,
		expectedState: "admitted" | "materialized",
		terminal: PostgresqlRunOperationTerminal,
		nowMs: number,
	): Promise<PostgresqlRunOperationStoreResult>;
	expire(nowMs: number): Promise<readonly PostgresqlRunOperationTerminal[]>;
	close(): void | PromiseLike<void>;
}

export interface PostgresqlRunOperationsSqlClient {
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

const INSTALL_SQL = `CREATE SCHEMA IF NOT EXISTS graphrefly_postgresql_run_operations_v1;
CREATE TABLE IF NOT EXISTS graphrefly_postgresql_run_operations_v1.requests (
 recovery_id text PRIMARY KEY, tenant_id text NOT NULL, workspace_id text NOT NULL,
 idempotency_key text NOT NULL, action text NOT NULL, body_fingerprint text NOT NULL,
 state text NOT NULL, request jsonb NOT NULL, admission jsonb, materialization jsonb,
 terminal jsonb, terminal_high_water bigint NOT NULL, expires_at_ms bigint NOT NULL,
 created_at_ms bigint NOT NULL, UNIQUE (tenant_id, workspace_id, idempotency_key));
CREATE TABLE IF NOT EXISTS graphrefly_postgresql_run_operations_v1.audit (
 audit_seq bigserial PRIMARY KEY, recovery_id text NOT NULL, event jsonb NOT NULL);`;

/** Concrete PG16 adapter. Every mutation is a parameterized transaction with state/body/high-water CAS. */
export function postgresql16RunOperationsStore(
	client: PostgresqlRunOperationsSqlClient,
): PostgresqlRunOperationsStore & { install(): Promise<void> } {
	const one = async (sql: string, values: readonly unknown[], expected?: StoreExpected) => {
		if ((sql.match(/\$\d+/g) ?? []).length === 0 && values.length > 0)
			throw new TypeError("Unbound PostgreSQL run-operations values.");
		return client.transaction(async (tx) => {
			const result = (await tx.query<{ result: PostgresqlRunOperationStoreResult }>(sql, values))
				.rows[0]?.result;
			return result === undefined
				? { accepted: false, code: "cas-rejected" }
				: storeResult(result, expected);
		});
	};
	return {
		compatibility: POSTGRESQL_RUN_OPERATIONS_COMPATIBILITY,
		schema: POSTGRESQL_RUN_OPERATIONS_SCHEMA,
		async install() {
			await client.transaction(async (tx) => {
				await tx.query(INSTALL_SQL, []);
			});
		},
		async record(r) {
			validateRequest(r);
			const fp = postgresqlRunOperationBodyFingerprint(r);
			return client.transaction(async (tx) => {
				const inserted = (
					await tx.query<{ request: PostgresqlRunOperationRequest }>(
						`WITH inserted AS (INSERT INTO graphrefly_postgresql_run_operations_v1.requests (recovery_id,tenant_id,workspace_id,idempotency_key,action,body_fingerprint,state,request,terminal_high_water,expires_at_ms,created_at_ms) VALUES ($1,$2,$3,$4,$5,$6,'requested',$7::jsonb,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING recovery_id,request), audited AS (INSERT INTO graphrefly_postgresql_run_operations_v1.audit (recovery_id,event) SELECT recovery_id,jsonb_build_object('kind','requested','atMs',$10) FROM inserted RETURNING audit_seq) SELECT request FROM inserted`,
						[
							r.recoveryId,
							r.target.tenantId,
							r.target.workspaceId,
							r.idempotencyKey,
							r.action,
							fp,
							JSON.stringify(r),
							r.target.terminalHighWater,
							r.expiresAtMs,
							r.requestedAtMs,
						],
					)
				).rows[0];
				if (inserted)
					return storeResult(
						{ accepted: true, code: "recorded", request: inserted.request },
						{ request: r, fp },
					);
				const existing = (
					await tx.query<{
						recovery_id: string;
						body_fingerprint: string;
						request: PostgresqlRunOperationRequest;
					}>(
						`SELECT recovery_id,body_fingerprint,request FROM graphrefly_postgresql_run_operations_v1.requests WHERE tenant_id=$1 AND workspace_id=$2 AND idempotency_key=$3 FOR UPDATE`,
						[r.target.tenantId, r.target.workspaceId, r.idempotencyKey],
					)
				).rows[0];
				if (!existing) {
					const identity = (
						await tx.query<{ body_fingerprint: string }>(
							`SELECT body_fingerprint FROM graphrefly_postgresql_run_operations_v1.requests WHERE recovery_id=$1 FOR UPDATE`,
							[r.recoveryId],
						)
					).rows[0];
					return identity
						? { accepted: false, code: "recovery-identity-conflict" }
						: { accepted: false, code: "concurrent-record-unverifiable" };
				}
				return existing.body_fingerprint === fp
					? storeResult(
							{
								accepted: true,
								code: "idempotent-rereference",
								request: existing.request,
							},
							{ request: r, fp },
						)
					: { accepted: false, code: "idempotency-conflict" };
			});
		},
		admit(r, t, now) {
			const fp = postgresqlRunOperationBodyFingerprint(r);
			assertEligible(r, t, now);
			const expectedAdmission = admission(r, fp, now);
			return one(
				`WITH changed AS (UPDATE graphrefly_postgresql_run_operations_v1.requests SET state='admitted',admission=$1::jsonb WHERE recovery_id=$2 AND state='requested' AND body_fingerprint=$3 AND terminal_high_water=$4 AND expires_at_ms>$5 RETURNING recovery_id,admission), audited AS (INSERT INTO graphrefly_postgresql_run_operations_v1.audit (recovery_id,event) SELECT recovery_id,jsonb_build_object('kind','admitted','atMs',$5) FROM changed RETURNING audit_seq) SELECT jsonb_build_object('accepted',true,'code','admitted','admission',admission) AS result FROM changed`,
				[JSON.stringify(expectedAdmission), r.recoveryId, fp, t.terminalHighWater, now],
				{ request: r, fp, mutation: "admit", now, expectedAdmission },
			);
		},
		materialize(r, t, m, now) {
			const fp = postgresqlRunOperationBodyFingerprint(r);
			assertEligible(r, t, now);
			const canonical = postgresqlRunOperationMaterialization(r, t, now);
			if (canonicalJson(m) !== canonicalJson(canonical))
				throw new TypeError("noncanonical-materialization");
			return one(
				`WITH changed AS (UPDATE graphrefly_postgresql_run_operations_v1.requests SET state='materialized',materialization=$1::jsonb WHERE recovery_id=$2 AND state='admitted' AND body_fingerprint=$3 AND terminal_high_water=$4 AND expires_at_ms>$5 RETURNING recovery_id,materialization,admission), audited AS (INSERT INTO graphrefly_postgresql_run_operations_v1.audit (recovery_id,event) SELECT recovery_id,jsonb_build_object('kind','materialized','atMs',$5) FROM changed RETURNING audit_seq) SELECT jsonb_build_object('accepted',true,'code','materialized','materialization',materialization,'receipt',jsonb_build_object('kind','postgresql-run-operation-materialization-receipt','recoveryId',recovery_id,'bodyFingerprint',$3,'terminalHighWater',$4,'action',materialization->>'action','materializationId',materialization->>'materializationId','admittedAtMs',(admission->>'decidedAtMs')::bigint,'materializedAtMs',$5,'materialization',materialization)) AS result FROM changed`,
				[JSON.stringify(canonical), r.recoveryId, fp, t.terminalHighWater, now],
				{ request: r, fp, materialization: canonical, truth: t, mutation: "materialize", now },
			);
		},
		async repairProposal(r, t, now) {
			assertEligible(r, t, now);
			if (r.action !== "repair") throw new TypeError("repair-action-required");
			const fp = postgresqlRunOperationBodyFingerprint(r);
			return client.transaction(async (tx) => {
				const row = (
					await tx.query<{
						state: string;
						body_fingerprint: string;
						terminal_high_water: number;
						materialization: PostgresqlRunOperationMaterialization;
					}>(
						`SELECT state,body_fingerprint,terminal_high_water,materialization FROM graphrefly_postgresql_run_operations_v1.requests WHERE recovery_id=$1 FOR UPDATE`,
						[r.recoveryId],
					)
				).rows[0];
				if (!row) return { accepted: false, code: "repair-materialization-missing" };
				validateStoredMaterialization(row.materialization);
				const canonical = postgresqlRunOperationMaterialization(
					r,
					t,
					row.materialization.materializedAtMs,
				);
				if (
					row.state !== "materialized" ||
					row.body_fingerprint !== fp ||
					row.terminal_high_water !== t.terminalHighWater ||
					canonicalJson(row.materialization) !== canonicalJson(canonical) ||
					row.materialization.repairProposal === null
				)
					return { accepted: false, code: "repair-materialization-mismatch" };
				return {
					accepted: true,
					code: "repair-proposal-ready",
					proposal: repairWorkItemProposal(row.materialization.repairProposal, r, now),
				};
			});
		},
		terminate(r, t, state, value, now) {
			assertCurrent(r, t, now);
			const fp = postgresqlRunOperationBodyFingerprint(r);
			const valueSafe = terminal(value);
			if (valueSafe.recoveryId !== r.recoveryId) throw new TypeError("terminal-recovery-mismatch");
			if (valueSafe.completedAtMs !== now) throw new TypeError("terminal-time-mismatch");
			if (valueSafe.state === "expired") throw new TypeError("expiry-owned-by-expire");
			if (
				state === "materialized"
					? valueSafe.state !== "materialized"
					: !["rejected", "canceled"].includes(valueSafe.state)
			)
				throw new TypeError("illegal-terminal-transition");
			if (valueSafe.successorRequestId !== undefined && state !== "materialized")
				throw new TypeError("successor-requires-materialization");
			return one(
				`WITH changed AS (UPDATE graphrefly_postgresql_run_operations_v1.requests SET state=$1,terminal=$2::jsonb WHERE recovery_id=$3 AND state=$4 AND body_fingerprint=$5 AND terminal_high_water=$6 AND expires_at_ms>$7 AND ($8::text IS NULL OR materialization->'candidateRequest'->>'requestId'=$8) RETURNING recovery_id,terminal), audited AS (INSERT INTO graphrefly_postgresql_run_operations_v1.audit (recovery_id,event) SELECT recovery_id,terminal FROM changed RETURNING audit_seq) SELECT jsonb_build_object('accepted',true,'code','terminal','terminal',terminal) AS result FROM changed`,
				[
					valueSafe.state,
					JSON.stringify(valueSafe),
					r.recoveryId,
					state,
					fp,
					t.terminalHighWater,
					now,
					valueSafe.successorRequestId ?? null,
				],
				{ request: r, fp, truth: t, terminal: valueSafe, mutation: "terminate", now },
			);
		},
		async expire(now) {
			const result = await client.transaction(async (tx) =>
				(
					await tx.query<{ terminal: PostgresqlRunOperationTerminal }>(
						`WITH changed AS (UPDATE graphrefly_postgresql_run_operations_v1.requests SET state='expired',terminal=jsonb_build_object('kind','postgresql-run-operation-terminal','recoveryId',recovery_id,'state','expired','code','request-expired','completedAtMs',$1,'auditRefs','[]'::jsonb) WHERE state IN ('requested','admitted') AND expires_at_ms<=$1 RETURNING recovery_id,terminal), audited AS (INSERT INTO graphrefly_postgresql_run_operations_v1.audit (recovery_id,event) SELECT recovery_id,terminal FROM changed RETURNING audit_seq) SELECT terminal FROM changed`,
						[now],
					)
				).rows.map((r) => snapshot(r.terminal)),
			);
			return result.map(terminal);
		},
		close: () => client.close(),
	};
}

export function postgresqlRunOperationBodyFingerprint(r: PostgresqlRunOperationRequest): string {
	validateRequest(r);
	return canonicalJson(r);
}

export function postgresqlRunOperationEligibility(
	r: PostgresqlRunOperationRequest,
	t: PostgresqlRunCurrentTruth,
	now: number,
): { eligible: boolean; code: string } {
	try {
		validateRequest(r);
		assertCurrent(r, t, now);
	} catch (e) {
		return { eligible: false, code: e instanceof Error ? e.message : "invalid" };
	}
	if (r.action === "resume")
		return { eligible: false, code: "resume-unsupported-no-checkpoint-authority" };
	if (r.action === "rollback") return { eligible: false, code: "generic-rollback-unsupported" };
	if (t.failureClass === "missing-input")
		return { eligible: false, code: "missing-input-blocks-all-operations" };
	if (t.failureClass === "credential-or-access")
		return { eligible: false, code: "credential-or-access-blocked" };
	if (t.failureClass === "stale-evidence")
		return { eligible: false, code: "refresh-current-evidence-required" };
	if (t.failureClass === "schema-drift" && r.action !== "repair")
		return { eligible: false, code: "schema-drift-requires-repair-proposal" };
	if (r.action === "retry" && !t.recoveryPolicyAllowsRetry)
		return { eligible: false, code: "retry-policy-denied" };
	if (r.action === "retry" && (!t.occurrenceVerified || !t.inputImmutable))
		return { eligible: false, code: "retry-occurrence-unverifiable" };
	if (
		(r.action === "replay" || r.action === "backfill") &&
		(!r.retainedWindow ||
			!t.retainedWindow ||
			canonicalJson(r.retainedWindow) !== canonicalJson(t.retainedWindow) ||
			!t.retentionVerified ||
			r.retainedWindow.retentionRevision !== r.target.retentionRevision ||
			r.retainedWindow.retainedUntilMs <= now)
	)
		return { eligible: false, code: "retained-snapshot-window-required" };
	if (
		(r.action === "rerun" || r.action === "replay" || r.action === "backfill") &&
		!t.successorCandidate
	)
		return { eligible: false, code: "fresh-lowered-input-and-route-required" };
	if (
		t.successorCandidate &&
		[
			t.successorCandidate.queryRevision,
			t.successorCandidate.specRevision,
			t.successorCandidate.schemaRevision,
			t.successorCandidate.artifactRevision,
			t.successorCandidate.policyRevision,
		].join("\u0000") !==
			[
				r.target.queryRevision,
				r.target.specRevision,
				r.target.schemaRevision,
				r.target.artifactRevision,
				r.target.policyRevision,
			].join("\u0000")
	)
		return { eligible: false, code: "successor-lowering-pin-mismatch" };
	return { eligible: true, code: "eligible" };
}

export function postgresqlRunOperationMaterialization(
	r: PostgresqlRunOperationRequest,
	t: PostgresqlRunCurrentTruth,
	now: number,
): PostgresqlRunOperationMaterialization {
	const e = postgresqlRunOperationEligibility(r, t, now);
	if (!e.eligible) throw new TypeError(e.code);
	if (r.action === "cancel" || r.action === "resume" || r.action === "rollback")
		throw new TypeError("Action is not materialized by the recovery ledger.");
	const common = {
		kind: "postgresql-run-operation-materialization" as const,
		recoveryId: r.recoveryId,
		action: r.action,
		materializationId: `materialization:${r.recoveryId}`,
		materializedAtMs: now,
	};
	if (r.action === "repair")
		return snapshot({
			...common,
			candidateRequest: null,
			repairProposal: {
				kind: "postgresql-repair-proposal",
				proposalId: `repair:${r.recoveryId}`,
				sourceRecoveryId: r.recoveryId,
				target: r.target,
				evidenceRefs: r.evidenceRefs,
			},
		});
	const next =
		r.action === "retry"
			? {
					adapterInputId: r.target.adapterInputId,
					requestId: r.target.requestId,
					operationId: r.target.operationId,
					routeId: r.target.routeId,
					executorId: r.target.executorId,
					profileId: r.target.profileId,
					environmentId: r.target.environmentId,
					environmentRevision: r.target.environmentRevision,
					environmentLocality: r.target.environmentLocality,
					environmentBindingKind: r.target.environmentBindingKind,
					executionSessionEpoch: r.target.executionSessionEpoch,
					deploymentFingerprint: r.target.deploymentFingerprint,
				}
			: t.successorCandidate;
	if (next === undefined) throw new TypeError("fresh-lowered-input-and-route-required");
	return snapshot({
		...common,
		repairProposal: null,
		candidateRequest: {
			kind: "tool-provider-adapter-run-requested",
			runId: `run:recovery:${r.recoveryId}`,
			adapterInputId: next.adapterInputId,
			requestId: next.requestId,
			operationId: next.operationId,
			routeId: next.routeId,
			executorId: next.executorId,
			profileId: next.profileId,
			attempt: r.action === "retry" ? r.target.attempt + 1 : 1,
			reason: r.action === "retry" ? "retry" : r.action,
			...(r.action === "retry" ? { retryOfOutcomeId: r.target.outcomeId } : {}),
			policyRefs: [{ kind: "policy", id: r.target.policyRevision }],
			sourceRefs: [...r.evidenceRefs, { kind: "postgresql-run-recovery", id: r.recoveryId }],
			metadata: {
				executionEnvironmentId: next.environmentId,
				executionEnvironmentRevision: next.environmentRevision,
				executionEnvironmentLocality: next.environmentLocality,
				executionEnvironmentBindingKind: next.environmentBindingKind,
				executionSessionEpoch: next.executionSessionEpoch,
				executionManifestFingerprint: next.deploymentFingerprint,
				sourceRunId: r.target.runId,
				sourceAttempt: r.target.attempt,
				sourceOutcomeId: r.target.outcomeId,
				terminalHighWater: r.target.terminalHighWater,
				...(r.retainedWindow === undefined ? {} : { retainedWindow: r.retainedWindow }),
			},
			requestedAtMs: now,
		},
	});
}

function validateRequest(r: PostgresqlRunOperationRequest) {
	exactKeys(
		r,
		[
			"kind",
			"recoveryId",
			"intentId",
			"idempotencyKey",
			"action",
			"actorId",
			"capabilityRevision",
			"target",
			"retainedWindow",
			"evidenceRefs",
			"requestedAtMs",
			"expiresAtMs",
		],
		["retainedWindow"],
	);
	if (
		!["retry", "rerun", "replay", "backfill", "repair", "cancel", "resume", "rollback"].includes(
			r.action,
		)
	)
		throw new TypeError("invalid-recovery-action");
	exactKeys(r.target, [
		"tenantId",
		"workspaceId",
		"requestId",
		"adapterInputId",
		"operationId",
		"workItemId",
		"routeId",
		"admissionId",
		"runId",
		"attempt",
		"outcomeId",
		"executorId",
		"profileId",
		"environmentRevision",
		"environmentId",
		"environmentLocality",
		"environmentBindingKind",
		"executionSessionEpoch",
		"deploymentFingerprint",
		"queryRevision",
		"specRevision",
		"inputRevision",
		"sourceRevision",
		"schemaRevision",
		"artifactRevision",
		"retentionRevision",
		"policyRevision",
		"terminalHighWater",
	]);
	for (const value of Object.values(r.target)) if (typeof value === "string") bounded(value);
	validateTarget(r.target);
	if (r.retainedWindow) {
		validateRetainedWindow(r.retainedWindow, r.requestedAtMs);
		exactKeys(r.retainedWindow, [
			"snapshotRef",
			"snapshotRevision",
			"windowStart",
			"windowEnd",
			"dedupeKey",
			"retentionRevision",
			"retainedUntilMs",
		]);
		sourceRef(r.retainedWindow.snapshotRef);
		for (const key of [
			"snapshotRevision",
			"windowStart",
			"windowEnd",
			"dedupeKey",
			"retentionRevision",
		] as const)
			bounded(r.retainedWindow[key]);
		if (
			!Number.isSafeInteger(r.retainedWindow.retainedUntilMs) ||
			r.retainedWindow.retainedUntilMs <= r.requestedAtMs ||
			r.retainedWindow.windowStart >= r.retainedWindow.windowEnd
		)
			throw new TypeError("invalid-retained-window");
	}
	if (!Array.isArray(r.evidenceRefs) || r.evidenceRefs.length > 32)
		throw new TypeError("invalid-evidence-refs");
	for (const ref of r.evidenceRefs) sourceRef(ref);
	if (
		r.kind !== "postgresql-run-operation-request" ||
		!r.recoveryId ||
		!r.intentId ||
		!r.idempotencyKey ||
		!r.actorId ||
		!r.capabilityRevision
	)
		throw new TypeError("invalid-recovery-request");
	for (const value of [r.recoveryId, r.intentId, r.idempotencyKey, r.actorId, r.capabilityRevision])
		persistedIdentity(value);
	if (
		!Number.isSafeInteger(r.target.attempt) ||
		r.target.attempt < 1 ||
		!Number.isSafeInteger(r.target.terminalHighWater) ||
		r.target.terminalHighWater < 1
	)
		throw new TypeError("invalid-target-coordinate");
	if (r.expiresAtMs <= r.requestedAtMs) throw new TypeError("invalid-request-expiry");
	snapshot(r);
	if (canonicalJson(r).length > 32_768) throw new TypeError("recovery-request-too-large");
}
function assertCurrent(
	r: PostgresqlRunOperationRequest,
	t: PostgresqlRunCurrentTruth,
	now: number,
) {
	validateRequest(r);
	exactKeys(
		t,
		[
			"kind",
			"target",
			"terminal",
			"occurrenceVerified",
			"inputImmutable",
			"authorized",
			"accessible",
			"retentionVerified",
			"currentAttempt",
			"terminalHighWater",
			"observedAtMs",
			"failureClass",
			"recoveryPolicyAllowsRetry",
			"authorizedActorId",
			"currentCapabilityRevision",
			"currentPolicyRevision",
			"successorCandidate",
			"retainedWindow",
		],
		["successorCandidate", "retainedWindow"],
	);
	if (t.kind !== "postgresql-run-current-truth") throw new TypeError("invalid-current-truth-kind");
	validateTarget(t.target);
	for (const value of [t.authorizedActorId, t.currentCapabilityRevision, t.currentPolicyRevision])
		persistedIdentity(value);
	for (const value of [t.currentAttempt, t.terminalHighWater, t.observedAtMs])
		if (!Number.isSafeInteger(value) || value < 0)
			throw new TypeError("invalid-current-truth-coordinate");
	for (const value of [
		t.terminal,
		t.occurrenceVerified,
		t.inputImmutable,
		t.authorized,
		t.accessible,
		t.retentionVerified,
		t.recoveryPolicyAllowsRetry,
	])
		if (typeof value !== "boolean") throw new TypeError("invalid-current-truth-boolean");
	if (
		![
			"missing-input",
			"credential-or-access",
			"runtime-loss",
			"timeout",
			"schema-drift",
			"partial-output",
			"stale-evidence",
			"retention-gap",
			"unverifiable-occurrence",
			"verified-failure",
		].includes(t.failureClass)
	)
		throw new TypeError("invalid-failure-class");
	if (t.successorCandidate)
		exactKeys(t.successorCandidate, [
			"adapterInputId",
			"requestId",
			"operationId",
			"routeId",
			"executorId",
			"profileId",
			"inputRevision",
			"queryRevision",
			"specRevision",
			"sourceRevision",
			"schemaRevision",
			"artifactRevision",
			"policyRevision",
			"environmentId",
			"environmentRevision",
			"environmentLocality",
			"environmentBindingKind",
			"executionSessionEpoch",
			"deploymentFingerprint",
		]);
	if (t.successorCandidate)
		for (const value of Object.values(t.successorCandidate)) persistedIdentity(value);
	if (t.retainedWindow) validateRetainedWindow(t.retainedWindow, 0);
	if (
		t.successorCandidate &&
		(!["local", "managed-cloud", "customer-hosted"].includes(
			t.successorCandidate.environmentLocality,
		) ||
			!["local-host-process", "local-container", "remote-session"].includes(
				t.successorCandidate.environmentBindingKind,
			))
	)
		throw new TypeError("invalid-successor-environment-kind");
	if (r.expiresAtMs <= now) throw new TypeError("request-expired");
	if (!t.terminal) throw new TypeError("target-not-terminal");
	if (!t.authorized) throw new TypeError("access-denied");
	if (!t.accessible) throw new TypeError("target-inaccessible");
	if (
		t.authorizedActorId !== r.actorId ||
		t.currentCapabilityRevision !== r.capabilityRevision ||
		t.currentPolicyRevision !== r.target.policyRevision
	)
		throw new TypeError("authorization-pin-mismatch");
	if (
		canonicalJson(r.target) !== canonicalJson(t.target) ||
		t.currentAttempt !== r.target.attempt ||
		t.terminalHighWater !== r.target.terminalHighWater
	)
		throw new TypeError("stale-or-mismatched-target");
}
function admission(
	r: PostgresqlRunOperationRequest,
	fp: string,
	now: number,
): PostgresqlRunOperationAdmission {
	return snapshot({
		kind: "postgresql-run-operation-admission",
		recoveryId: r.recoveryId,
		state: "admitted",
		code: "admitted",
		bodyFingerprint: fp,
		decidedAtMs: now,
		auditRefs: [{ kind: "postgresql-run-operation-audit", id: `admit:${r.recoveryId}` }],
	});
}
function assertEligible(
	r: PostgresqlRunOperationRequest,
	t: PostgresqlRunCurrentTruth,
	now: number,
) {
	const value = postgresqlRunOperationEligibility(r, t, now);
	if (!value.eligible) throw new TypeError(value.code);
}
function snapshot<T>(v: T): T {
	const cloned = structuredClone(v);
	const freeze = (x: unknown): unknown => {
		if (x !== null && typeof x === "object") {
			for (const y of Object.values(x)) freeze(y);
			Object.freeze(x);
		}
		return x;
	};
	return freeze(cloned) as T;
}

function bounded(value: string) {
	if (value.length < 1 || value.length > 256 || [...value].some((c) => c.charCodeAt(0) < 32))
		throw new TypeError("invalid-bounded-string");
}
function persistedIdentity(value: unknown) {
	if (typeof value !== "string") throw new TypeError("invalid-identity-string");
	bounded(value);
	if (simplePersistedIdentity(value)) return;
	const tupleText = value.startsWith("[")
		? value
		: (() => {
				const at = value.indexOf(":");
				if (at < 1 || !simplePersistedIdentity(value.slice(0, at)) || value[at + 1] !== "[")
					return undefined;
				return value.slice(at + 1);
			})();
	if (tupleText === undefined) throw new TypeError("forbidden-identity-material");
	let parsed: unknown;
	try {
		parsed = JSON.parse(tupleText);
	} catch {
		throw new TypeError("invalid-canonical-identity-tuple");
	}
	validateIdentityTuple(parsed, 0);
}
function simplePersistedIdentity(value: string) {
	return (
		/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value) &&
		!/(?:^|[._:@/-])(?:credential|password|passwd|secret|token|access_token|api_key|authorization|cookie|bearer|private-key|private_key|dsn)(?:$|[._:@/-])/iu.test(
			value,
		) &&
		!/(?:https?:\/\/|-----begin|postgres(?:ql)?:\/\/|connection[-_]?string)/iu.test(value)
	);
}
function validateIdentityTuple(value: unknown, depth: number): void {
	if (!Array.isArray(value) || value.length < 1 || value.length > 32 || depth > 4)
		throw new TypeError("invalid-canonical-identity-tuple");
	for (const atom of value) {
		if (typeof atom === "string") {
			bounded(atom);
			if (!simplePersistedIdentity(atom)) throw new TypeError("forbidden-identity-material");
		} else if (typeof atom === "number") {
			if (!Number.isSafeInteger(atom)) throw new TypeError("invalid-canonical-identity-tuple");
		} else if (Array.isArray(atom)) validateIdentityTuple(atom, depth + 1);
		else throw new TypeError("invalid-canonical-identity-tuple");
	}
}
interface StoreExpected {
	readonly request?: PostgresqlRunOperationRequest;
	readonly fp?: string;
	readonly materialization?: PostgresqlRunOperationMaterialization;
	readonly truth?: PostgresqlRunCurrentTruth;
	readonly terminal?: PostgresqlRunOperationTerminal;
	readonly mutation?: "admit" | "materialize" | "terminate";
	readonly now?: number;
	readonly expectedAdmission?: PostgresqlRunOperationAdmission;
}
function storeResult(
	value: PostgresqlRunOperationStoreResult,
	expected?: StoreExpected,
): PostgresqlRunOperationStoreResult {
	exactKeys(
		value,
		["accepted", "code", "request", "admission", "materialization", "terminal", "receipt"],
		["request", "admission", "materialization", "terminal", "receipt"],
	);
	if (typeof value.accepted !== "boolean") throw new TypeError("invalid-store-accepted");
	bounded(value.code);
	if (value.request) {
		validateRequest(value.request);
		if (expected?.request && canonicalJson(value.request) !== canonicalJson(expected.request))
			throw new TypeError("store-request-mismatch");
	}
	if (value.admission) {
		exactKeys(value.admission, [
			"kind",
			"recoveryId",
			"state",
			"code",
			"bodyFingerprint",
			"decidedAtMs",
			"auditRefs",
		]);
		if (
			value.admission.kind !== "postgresql-run-operation-admission" ||
			!["admitted", "denied", "expired"].includes(value.admission.state) ||
			!Number.isSafeInteger(value.admission.decidedAtMs)
		)
			throw new TypeError("invalid-store-admission");
		if (
			expected?.request &&
			(value.admission.recoveryId !== expected.request.recoveryId ||
				value.admission.bodyFingerprint !== expected.fp)
		)
			throw new TypeError("store-admission-mismatch");
		if (
			expected?.expectedAdmission &&
			canonicalJson(value.admission) !== canonicalJson(expected.expectedAdmission)
		)
			throw new TypeError("store-admission-canonical-mismatch");
		if (
			expected?.mutation === "admit" &&
			(value.code !== "admitted" ||
				value.admission.state !== "admitted" ||
				value.admission.code !== "admitted" ||
				value.admission.decidedAtMs !== expected.now)
		)
			throw new TypeError("store-admission-coherence-mismatch");
		for (const ref of value.admission.auditRefs) sourceRef(ref);
	}
	if (value.materialization) {
		validateStoredMaterialization(value.materialization);
		if (
			expected?.materialization &&
			canonicalJson(value.materialization) !== canonicalJson(expected.materialization)
		)
			throw new TypeError("store-materialization-mismatch");
	}
	if (value.receipt) {
		if (!expected?.request || !expected.materialization || !expected.truth)
			throw new TypeError("unexpected-materialization-receipt");
		validateReceipt(value.receipt, expected.request, expected.truth);
		if (
			canonicalJson(value.receipt.materialization) !== canonicalJson(expected.materialization) ||
			value.receipt.bodyFingerprint !== expected.fp
		)
			throw new TypeError("store-receipt-mismatch");
	}
	if (value.accepted && value.materialization && !value.receipt)
		throw new TypeError("missing-materialization-receipt");
	if (expected?.mutation === "admit" && value.accepted && !value.admission)
		throw new TypeError("missing-store-admission");
	if (
		expected?.mutation === "materialize" &&
		value.accepted &&
		(value.code !== "materialized" || !value.materialization || !value.receipt)
	)
		throw new TypeError("store-materialization-coherence-mismatch");
	if (value.terminal) {
		terminal(value.terminal);
		if (expected?.terminal && canonicalJson(value.terminal) !== canonicalJson(expected.terminal))
			throw new TypeError("store-terminal-mismatch");
	}
	if (
		expected?.mutation === "terminate" &&
		value.accepted &&
		(value.code !== "terminal" || !value.terminal)
	)
		throw new TypeError("store-terminal-coherence-mismatch");
	return snapshot(value);
}
function validateStoredMaterialization(value: PostgresqlRunOperationMaterialization) {
	exactKeys(value, [
		"kind",
		"recoveryId",
		"action",
		"materializationId",
		"candidateRequest",
		"repairProposal",
		"materializedAtMs",
	]);
	if (
		value.kind !== "postgresql-run-operation-materialization" ||
		!["retry", "rerun", "replay", "backfill", "repair"].includes(value.action) ||
		!Number.isSafeInteger(value.materializedAtMs) ||
		value.materializationId !== `materialization:${value.recoveryId}`
	)
		throw new TypeError("invalid-store-materialization");
	if (value.action === "repair") {
		if (value.candidateRequest !== null || value.repairProposal === null)
			throw new TypeError("invalid-store-repair-materialization");
		const p = value.repairProposal;
		exactKeys(p, ["kind", "proposalId", "sourceRecoveryId", "target", "evidenceRefs"]);
		if (
			p.kind !== "postgresql-repair-proposal" ||
			p.sourceRecoveryId !== value.recoveryId ||
			p.proposalId !== `repair:${value.recoveryId}`
		)
			throw new TypeError("invalid-store-repair-proposal");
		validateTarget(p.target);
		for (const ref of p.evidenceRefs) sourceRef(ref);
	} else {
		if (value.candidateRequest === null || value.repairProposal !== null)
			throw new TypeError("invalid-store-candidate-materialization");
		const c = value.candidateRequest;
		exactKeys(
			c,
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
				"metadata",
				"requestedAtMs",
			],
			["providerId", "retryOfOutcomeId"],
		);
		if (
			c.kind !== "tool-provider-adapter-run-requested" ||
			!Number.isSafeInteger(c.attempt) ||
			!Number.isSafeInteger(c.requestedAtMs)
		)
			throw new TypeError("invalid-store-candidate");
		if (c.metadata === undefined) throw new TypeError("missing-store-candidate-metadata");
		exactKeys(
			c.metadata,
			[
				"executionEnvironmentId",
				"executionEnvironmentRevision",
				"executionEnvironmentLocality",
				"executionEnvironmentBindingKind",
				"executionSessionEpoch",
				"executionManifestFingerprint",
				"sourceRunId",
				"sourceAttempt",
				"sourceOutcomeId",
				"terminalHighWater",
				"retainedWindow",
			],
			["retainedWindow"],
		);
		for (const ref of [...(c.policyRefs ?? []), ...(c.sourceRefs ?? [])]) sourceRef(ref);
	}
}
function validateReceipt(
	value: PostgresqlRunOperationMaterializationReceipt,
	request: PostgresqlRunOperationRequest,
	truth: PostgresqlRunCurrentTruth,
) {
	exactKeys(value, [
		"kind",
		"recoveryId",
		"bodyFingerprint",
		"terminalHighWater",
		"action",
		"materializationId",
		"admittedAtMs",
		"materializedAtMs",
		"materialization",
	]);
	validateStoredMaterialization(value.materialization);
	if (
		value.kind !== "postgresql-run-operation-materialization-receipt" ||
		value.recoveryId !== request.recoveryId ||
		value.bodyFingerprint !== postgresqlRunOperationBodyFingerprint(request) ||
		value.terminalHighWater !== truth.terminalHighWater ||
		value.action !== value.materialization.action ||
		value.materializationId !== value.materialization.materializationId ||
		value.materializedAtMs !== value.materialization.materializedAtMs ||
		!Number.isSafeInteger(value.admittedAtMs) ||
		value.admittedAtMs > value.materializedAtMs
	)
		throw new TypeError("invalid-materialization-receipt");
}
function terminal(value: PostgresqlRunOperationTerminal): PostgresqlRunOperationTerminal {
	exactKeys(
		value,
		["kind", "recoveryId", "state", "code", "successorRequestId", "completedAtMs", "auditRefs"],
		["successorRequestId"],
	);
	if (
		value.kind !== "postgresql-run-operation-terminal" ||
		!["materialized", "rejected", "canceled", "expired"].includes(value.state) ||
		!Number.isSafeInteger(value.completedAtMs)
	)
		throw new TypeError("invalid-terminal");
	persistedIdentity(value.recoveryId);
	persistedIdentity(value.code);
	for (const ref of value.auditRefs) sourceRef(ref);
	return snapshot(value);
}
function sourceRef(value: SourceRef) {
	exactKeys(value, ["kind", "id"]);
	persistedIdentity(value.kind);
	persistedIdentity(value.id);
}
function validateTarget(value: PostgresqlRunTarget) {
	exactKeys(value, [
		"tenantId",
		"workspaceId",
		"requestId",
		"adapterInputId",
		"operationId",
		"workItemId",
		"routeId",
		"admissionId",
		"runId",
		"attempt",
		"outcomeId",
		"executorId",
		"profileId",
		"environmentRevision",
		"environmentId",
		"environmentLocality",
		"environmentBindingKind",
		"executionSessionEpoch",
		"deploymentFingerprint",
		"queryRevision",
		"specRevision",
		"inputRevision",
		"sourceRevision",
		"schemaRevision",
		"artifactRevision",
		"retentionRevision",
		"policyRevision",
		"terminalHighWater",
	]);
	for (const key of Object.keys(value))
		if (key !== "attempt" && key !== "terminalHighWater")
			persistedIdentity((value as unknown as Record<string, unknown>)[key]);
	if (!Number.isSafeInteger(value.attempt) || !Number.isSafeInteger(value.terminalHighWater))
		throw new TypeError("invalid-target-coordinate");
	if (
		!["local", "managed-cloud", "customer-hosted"].includes(value.environmentLocality) ||
		!["local-host-process", "local-container", "remote-session"].includes(
			value.environmentBindingKind,
		)
	)
		throw new TypeError("invalid-target-environment-kind");
	if (
		value.environmentLocality === "local"
			? value.environmentBindingKind === "remote-session"
			: value.environmentBindingKind !== "remote-session"
	)
		throw new TypeError("invalid-target-locality-binding");
}
function validateRetainedWindow(value: PostgresqlRetainedWindow, requestedAtMs: number) {
	exactKeys(value, [
		"snapshotRef",
		"snapshotRevision",
		"windowStart",
		"windowEnd",
		"dedupeKey",
		"retentionRevision",
		"retainedUntilMs",
	]);
	sourceRef(value.snapshotRef);
	for (const item of [
		value.snapshotRevision,
		value.windowStart,
		value.windowEnd,
		value.dedupeKey,
		value.retentionRevision,
	])
		persistedIdentity(item);
	if (
		!Number.isSafeInteger(value.retainedUntilMs) ||
		value.retainedUntilMs <= requestedAtMs ||
		value.windowStart >= value.windowEnd
	)
		throw new TypeError("invalid-retained-window");
}
function exactKeys(value: object, allowed: readonly string[], optional: readonly string[] = []) {
	if (Object.getPrototypeOf(value) !== Object.prototype)
		throw new TypeError("non-plain-recovery-material");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const d of Object.values(descriptors))
		if ("get" in d || "set" in d) throw new TypeError("accessor-recovery-material");
	const keys = Object.keys(value);
	for (const key of keys)
		if (!allowed.includes(key)) throw new TypeError(`unknown-recovery-field:${key}`);
	for (const key of allowed)
		if (!optional.includes(key) && !keys.includes(key))
			throw new TypeError(`missing-recovery-field:${key}`);
}
function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalValue(value));
}
function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			const item = (value as Record<string, unknown>)[key];
			if (item !== undefined) out[key] = canonicalValue(item);
		}
		return out;
	}
	return value;
}
