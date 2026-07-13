import { describe, expect, it, vi } from "vitest";
import {
	POSTGRESQL_RUN_OPERATIONS_COMPATIBILITY,
	POSTGRESQL_RUN_OPERATIONS_SCHEMA,
	type PostgresqlRunCurrentTruth,
	type PostgresqlRunOperationRequest,
	type PostgresqlRunOperationsSqlClient,
	postgresql16RunOperationsStore,
	postgresqlRunOperationBodyFingerprint,
	postgresqlRunOperationEligibility,
	postgresqlRunOperationMaterialization,
} from "../executors/postgresql-run-operations.js";

const target = {
	tenantId: "tenant",
	workspaceId: "workspace",
	requestId: "request",
	adapterInputId: "adapter-input",
	operationId: "operation",
	workItemId: "work-item",
	routeId: "route",
	admissionId: "admission",
	runId: "run",
	attempt: 2,
	outcomeId: "outcome",
	executorId: "executor",
	profileId: "profile",
	environmentRevision: "env-v1",
	environmentId: "environment-local",
	environmentLocality: "local" as const,
	environmentBindingKind: "local-host-process" as const,
	executionSessionEpoch: "session:local-host-process",
	deploymentFingerprint: "deploy-v1",
	queryRevision: "query-v1",
	specRevision: "spec-v1",
	inputRevision: "input-v1",
	sourceRevision: "source-v1",
	schemaRevision: "schema-v1",
	artifactRevision: "artifact-v1",
	retentionRevision: "retention-v1",
	policyRevision: "policy-v1",
	terminalHighWater: 9,
};
const request = (
	action: PostgresqlRunOperationRequest["action"] = "rerun",
): PostgresqlRunOperationRequest => ({
	kind: "postgresql-run-operation-request",
	recoveryId: `recovery-${action}`,
	intentId: `intent-${action}`,
	idempotencyKey: `key-${action}`,
	action,
	actorId: "actor",
	capabilityRevision: "cap-v1",
	target,
	evidenceRefs: [{ kind: "outcome", id: "outcome" }],
	requestedAtMs: 100,
	expiresAtMs: 1000,
	...(action === "replay" || action === "backfill"
		? {
				retainedWindow: {
					snapshotRef: { kind: "snapshot", id: "snap" },
					snapshotRevision: "snap-v1",
					windowStart: "2026-01-01",
					windowEnd: "2026-01-02",
					dedupeKey: "dedupe",
					retentionRevision: "retention-v1",
					retainedUntilMs: 900,
				},
			}
		: {}),
});
const truth = (patch: Partial<PostgresqlRunCurrentTruth> = {}): PostgresqlRunCurrentTruth => ({
	kind: "postgresql-run-current-truth",
	target,
	terminal: true,
	occurrenceVerified: true,
	inputImmutable: true,
	authorized: true,
	accessible: true,
	retentionVerified: true,
	currentAttempt: 2,
	terminalHighWater: 9,
	observedAtMs: 150,
	failureClass: "verified-failure",
	recoveryPolicyAllowsRetry: true,
	authorizedActorId: "actor",
	currentCapabilityRevision: "cap-v1",
	currentPolicyRevision: "policy-v1",
	retainedWindow: {
		snapshotRef: { kind: "snapshot", id: "snap" },
		snapshotRevision: "snap-v1",
		windowStart: "2026-01-01",
		windowEnd: "2026-01-02",
		dedupeKey: "dedupe",
		retentionRevision: "retention-v1",
		retainedUntilMs: 900,
	},
	successorCandidate: {
		adapterInputId: "fresh-input",
		requestId: "fresh-request",
		operationId: "fresh-operation",
		routeId: "fresh-route",
		executorId: "executor",
		profileId: "profile",
		inputRevision: "fresh-input-v1",
		queryRevision: "query-v1",
		specRevision: "spec-v1",
		sourceRevision: "source-v1",
		schemaRevision: "schema-v1",
		artifactRevision: "artifact-v1",
		policyRevision: "policy-v1",
		environmentId: "environment-local",
		environmentRevision: "env-v1",
		environmentLocality: "local",
		environmentBindingKind: "local-host-process",
		executionSessionEpoch: "session:local-host-process",
		deploymentFingerprint: "deploy-v1",
	},
	...patch,
});

describe("D607 PostgreSQL run operations", () => {
	it("creates a strict new D419 candidate and never executes or mutates the old run", () => {
		const r = request("rerun"),
			m = postgresqlRunOperationMaterialization(r, truth(), 200);
		expect(m.candidateRequest).toMatchObject({
			kind: "tool-provider-adapter-run-requested",
			reason: "rerun",
			adapterInputId: "fresh-input",
			requestId: "fresh-request",
			metadata: {
				executionEnvironmentId: "environment-local",
				executionEnvironmentRevision: "env-v1",
				executionEnvironmentLocality: "local",
				executionEnvironmentBindingKind: "local-host-process",
				executionSessionEpoch: "session:local-host-process",
			},
		});
		expect(m.repairProposal).toBeNull();
		expect(Object.isFrozen(m)).toBe(true);
		expect(Object.isFrozen(m.candidateRequest?.metadata)).toBe(true);
	});
	it("keeps retry, replay/backfill, repair, resume, rollback, and cancel semantics separate", () => {
		expect(
			postgresqlRunOperationEligibility(
				request("retry"),
				truth({ occurrenceVerified: false }),
				200,
			),
		).toEqual({ eligible: false, code: "retry-occurrence-unverifiable" });
		expect(
			postgresqlRunOperationEligibility(
				request("retry"),
				truth({ failureClass: "schema-drift" }),
				200,
			).code,
		).toBe("schema-drift-requires-repair-proposal");
		expect(
			postgresqlRunOperationEligibility(
				request("repair"),
				truth({ failureClass: "schema-drift" }),
				200,
			).eligible,
		).toBe(true);
		expect(
			postgresqlRunOperationEligibility(
				request("rerun"),
				truth({ failureClass: "stale-evidence" }),
				200,
			).code,
		).toBe("refresh-current-evidence-required");
		expect(
			postgresqlRunOperationEligibility(
				request("replay"),
				truth({ retainedWindow: { ...truth().retainedWindow!, dedupeKey: "other" } }),
				200,
			).code,
		).toBe("retained-snapshot-window-required");
		expect(
			postgresqlRunOperationEligibility(
				request("retry"),
				truth({ failureClass: "runtime-loss", recoveryPolicyAllowsRetry: true }),
				200,
			).eligible,
		).toBe(true);
		expect(
			postgresqlRunOperationEligibility(
				{ ...request("replay"), retainedWindow: undefined },
				truth(),
				200,
			).code,
		).toBe("retained-snapshot-window-required");
		expect(postgresqlRunOperationEligibility(request("resume"), truth(), 200).code).toBe(
			"resume-unsupported-no-checkpoint-authority",
		);
		expect(postgresqlRunOperationEligibility(request("rollback"), truth(), 200).code).toBe(
			"generic-rollback-unsupported",
		);
		expect(() => postgresqlRunOperationMaterialization(request("cancel"), truth(), 200)).toThrow(
			"not materialized",
		);
		const repair = postgresqlRunOperationMaterialization(request("repair"), truth(), 200);
		expect(repair.repairProposal?.kind).toBe("postgresql-repair-proposal");
		expect(repair.candidateRequest).toBeNull();
	});
	it("fails closed for stale, live, unauthorized, inaccessible, expired, and hostile coordinates", () => {
		for (const t of [
			truth({ terminal: false }),
			truth({ authorized: false }),
			truth({ accessible: false }),
			truth({ currentAttempt: 3 }),
			truth({ terminalHighWater: 10 }),
		])
			expect(postgresqlRunOperationEligibility(request(), t, 200).eligible).toBe(false);
		expect(postgresqlRunOperationEligibility(request(), truth(), 1001).code).toBe(
			"request-expired",
		);
		expect(() =>
			postgresqlRunOperationBodyFingerprint({ ...request(), target: { ...target, attempt: 0 } }),
		).toThrow("invalid-target-coordinate");
		expect(() =>
			postgresqlRunOperationBodyFingerprint({
				...request(),
				rawSql: "select secret",
			} as PostgresqlRunOperationRequest),
		).toThrow("unknown-recovery-field:rawSql");
		expect(() =>
			postgresqlRunOperationBodyFingerprint({
				...request(),
				evidenceRefs: [{ kind: "log", id: "x", metadata: { credential: "secret" } }],
			}),
		).toThrow("unknown-recovery-field:metadata");
		const hostile = request();
		Object.defineProperty(hostile, "rawSql", {
			enumerable: true,
			get() {
				throw new Error("getter-ran");
			},
		});
		expect(() => postgresqlRunOperationBodyFingerprint(hostile)).toThrow(
			"accessor-recovery-material",
		);
		expect(
			postgresqlRunOperationEligibility(request(), truth({ authorizedActorId: "other" }), 200).code,
		).toBe("authorization-pin-mismatch");
		const base = request();
		const reordered = {
			...base,
			target: Object.fromEntries(Object.entries(base.target).reverse()) as typeof base.target,
		};
		expect(postgresqlRunOperationBodyFingerprint(reordered)).toBe(
			postgresqlRunOperationBodyFingerprint(base),
		);
		for (const changed of [
			{ ...base, actorId: "actor-2" },
			{ ...base, capabilityRevision: "cap-v2" },
			{ ...base, recoveryId: "recovery-2" },
			{ ...base, requestedAtMs: 101 },
			{ ...base, expiresAtMs: 999 },
		])
			expect(postgresqlRunOperationBodyFingerprint(changed)).not.toBe(
				postgresqlRunOperationBodyFingerprint(base),
			);
		expect(() =>
			postgresqlRunOperationBodyFingerprint({
				...request("replay"),
				retainedWindow: { ...request("replay").retainedWindow!, windowStart: "z", windowEnd: "a" },
			}),
		).toThrow("invalid-retained-window");
		expect(() =>
			postgresqlRunOperationBodyFingerprint({
				...request(),
				action: "destroy",
			} as PostgresqlRunOperationRequest),
		).toThrow("invalid-recovery-action");
		for (const hostile of [123, { id: "x" }, Symbol("x")])
			expect(() =>
				postgresqlRunOperationBodyFingerprint({ ...request(), recoveryId: hostile as string }),
			).toThrow("invalid-identity-string");
		for (const marker of [
			"credential:password",
			"x:passwd",
			"x.secret",
			"x/token",
			"access_token:x",
			"api_key:x",
			"authorization:x",
			"cookie:x",
			"bearer:x",
			"private-key:x",
			"private_key:x",
			"dsn:x",
			"https://signed.example",
			"-----BEGIN-PRIVATE-KEY",
			"postgresql://host/db",
			"connection_string:x",
		])
			expect(() =>
				postgresqlRunOperationBodyFingerprint({ ...request(), intentId: marker }),
			).toThrow("forbidden-identity-material");
		expect(() =>
			postgresqlRunOperationBodyFingerprint({
				...request(),
				evidenceRefs: [{ kind: "evidence", id: "api_key:x" }],
			}),
		).toThrow("forbidden-identity-material");
		const oldOutcomeId = '["tool-provider-outcome","request:1","operation:1","run:1",1]';
		expect(() =>
			postgresqlRunOperationBodyFingerprint({
				...request(),
				target: { ...target, outcomeId: oldOutcomeId },
			}),
		).not.toThrow();
		expect(() =>
			postgresqlRunOperationBodyFingerprint({
				...request(),
				target: { ...target, outcomeId: 'outcome:["request:1",1,["attempt",2]]' },
			}),
		).not.toThrow();
		expect(() =>
			postgresqlRunOperationBodyFingerprint({
				...request(),
				target: { ...target, outcomeId: '["credential:password",1]' },
			}),
		).toThrow("forbidden-identity-material");
		expect(() =>
			postgresqlRunOperationBodyFingerprint({
				...request(),
				target: {
					...target,
					environmentLocality: "managed-cloud",
					environmentBindingKind: "local-host-process",
				},
			} as PostgresqlRunOperationRequest),
		).toThrow("invalid-target-locality-binding");
		expect(
			postgresqlRunOperationEligibility(
				request(),
				truth({ failureClass: "mystery" as PostgresqlRunCurrentTruth["failureClass"] }),
				200,
			).code,
		).toBe("invalid-failure-class");
		expect(
			postgresqlRunOperationEligibility(
				request(),
				{ ...truth(), privateClient: "x" } as PostgresqlRunCurrentTruth,
				200,
			).code,
		).toBe("unknown-recovery-field:privateClient");
		const accessorTruth = truth();
		Object.defineProperty(accessorTruth, "privateClient", {
			enumerable: true,
			get() {
				throw new Error("getter-ran");
			},
		});
		expect(postgresqlRunOperationEligibility(request(), accessorTruth, 200).code).toBe(
			"accessor-recovery-material",
		);
		expect(
			postgresqlRunOperationEligibility(
				request(),
				truth({
					successorCandidate: {
						...truth().successorCandidate!,
						executionSessionEpoch: "bad\u0000session",
					},
				}),
				200,
			).code,
		).toBe("invalid-bounded-string");
		for (const hostile of [
			123,
			{ id: "x" },
			Symbol("x"),
			"credential:password",
			"Bearer-token",
			"-----BEGIN-KEY",
		]) {
			expect(
				postgresqlRunOperationEligibility(
					request(),
					truth({
						successorCandidate: {
							...truth().successorCandidate!,
							deploymentFingerprint: hostile as string,
						},
					}),
					200,
				).eligible,
			).toBe(false);
		}
		const hostileWindow = {
			...truth().retainedWindow!,
		} as PostgresqlRunCurrentTruth["retainedWindow"] & Record<string, unknown>;
		hostileWindow.privateCredential = "password";
		expect(
			postgresqlRunOperationEligibility(request(), truth({ retainedWindow: hostileWindow }), 200)
				.code,
		).toBe("unknown-recovery-field:privateCredential");
		expect(
			postgresqlRunOperationEligibility(
				request(),
				truth({
					successorCandidate: {
						...truth().successorCandidate!,
						deploymentFingerprint: "x".repeat(300),
					},
				}),
				200,
			).code,
		).toBe("invalid-bounded-string");
	});
	it("uses separate PG16 append-only/CAS schema with body and terminal high-water guards", async () => {
		const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
		const r = request();
		const fp = postgresqlRunOperationBodyFingerprint(r),
			canonicalForStore = postgresqlRunOperationMaterialization(r, truth(), 200),
			terminalForStore = {
				kind: "postgresql-run-operation-terminal" as const,
				recoveryId: r.recoveryId,
				state: "materialized" as const,
				code: "successor-recorded",
				successorRequestId: "fresh-request",
				completedAtMs: 201,
				auditRefs: [{ kind: "audit", id: "terminal" }],
			};
		const client: PostgresqlRunOperationsSqlClient = {
			transaction: async (work) =>
				work({
					query: async (sql, values) => {
						calls.push({ sql, values });
						if (sql.includes("SELECT request FROM inserted")) return { rows: [{ request: r }] };
						if (sql.includes("'code','admitted'"))
							return {
								rows: [
									{
										result: {
											accepted: true,
											code: "admitted",
											admission: {
												kind: "postgresql-run-operation-admission",
												recoveryId: r.recoveryId,
												state: "admitted",
												code: "admitted",
												bodyFingerprint: fp,
												decidedAtMs: 200,
												auditRefs: [
													{ kind: "postgresql-run-operation-audit", id: `admit:${r.recoveryId}` },
												],
											},
										},
									},
								],
							};
						if (sql.includes("postgresql-run-operation-materialization-receipt"))
							return {
								rows: [
									{
										result: {
											accepted: true,
											code: "materialized",
											materialization: canonicalForStore,
											receipt: {
												kind: "postgresql-run-operation-materialization-receipt",
												recoveryId: r.recoveryId,
												bodyFingerprint: fp,
												terminalHighWater: truth().terminalHighWater,
												action: canonicalForStore.action,
												materializationId: canonicalForStore.materializationId,
												admittedAtMs: 200,
												materializedAtMs: 200,
												materialization: canonicalForStore,
											},
										},
									},
								],
							};
						if (sql.includes("'code','terminal'"))
							return {
								rows: [
									{ result: { accepted: true, code: "terminal", terminal: terminalForStore } },
								],
							};
						return { rows: [{ result: { accepted: true, code: "ok" } }] };
					},
				}),
			close: vi.fn(),
		};
		const store = postgresql16RunOperationsStore(client);
		expect(store.compatibility).toBe(POSTGRESQL_RUN_OPERATIONS_COMPATIBILITY);
		expect(store.schema).toBe(POSTGRESQL_RUN_OPERATIONS_SCHEMA);
		await store.install();
		await store.record(r);
		await store.admit(r, truth(), 200);
		await store.materialize(
			r,
			truth(),
			postgresqlRunOperationMaterialization(r, truth(), 200),
			200,
		);
		await store.terminate(r, truth(), "materialized", terminalForStore, 201);
		expect(calls[0]?.sql).toContain(
			"CREATE SCHEMA IF NOT EXISTS graphrefly_postgresql_run_operations_v1",
		);
		expect(calls[0]?.sql).toContain("UNIQUE (tenant_id, workspace_id, idempotency_key)");
		expect(calls[1]?.sql).toContain("ON CONFLICT DO NOTHING");
		expect(calls[1]?.sql).toContain("INSERT INTO graphrefly_postgresql_run_operations_v1.audit");
		expect(calls[2]?.sql).toContain("body_fingerprint=$3 AND terminal_high_water=$4");
		expect(calls[3]?.sql).toContain(
			"state='admitted' AND body_fingerprint=$3 AND terminal_high_water=$4",
		);
		expect(calls[4]?.sql).toContain(
			"body_fingerprint=$5 AND terminal_high_water=$6 AND expires_at_ms>$7",
		);
		expect(() =>
			store.terminate(
				r,
				truth(),
				"admitted",
				{
					kind: "postgresql-run-operation-terminal",
					recoveryId: "wrong",
					state: "rejected",
					code: "x",
					completedAtMs: 201,
					auditRefs: [],
				},
				201,
			),
		).toThrow("terminal-recovery-mismatch");
		expect(() =>
			store.terminate(
				r,
				truth(),
				"admitted",
				{
					kind: "postgresql-run-operation-terminal",
					recoveryId: r.recoveryId,
					state: "expired",
					code: "x",
					completedAtMs: 201,
					auditRefs: [],
				},
				201,
			),
		).toThrow("expiry-owned-by-expire");
		expect(() =>
			store.terminate(
				r,
				truth(),
				"admitted",
				{
					kind: "postgresql-run-operation-terminal",
					recoveryId: r.recoveryId,
					state: "rejected",
					code: "x",
					completedAtMs: 202,
					auditRefs: [],
				},
				201,
			),
		).toThrow("terminal-time-mismatch");
		expect(
			calls
				.slice(1)
				.every((call) => call.sql.includes("graphrefly_postgresql_run_operations_v1.audit")),
		).toBe(true);
		expect(() => store.admit(request("retry"), truth({ occurrenceVerified: false }), 200)).toThrow(
			"retry-occurrence-unverifiable",
		);
		const canonical = postgresqlRunOperationMaterialization(r, truth(), 200);
		expect(() =>
			store.materialize(r, truth(), { ...canonical, materializationId: "attacker" }, 200),
		).toThrow("noncanonical-materialization");
	});
	it("distinguishes concurrent rereference, conflict, and zero-row CAS without permissive fake acceptance", async () => {
		const original = request(),
			fp = postgresqlRunOperationBodyFingerprint(original);
		let mode: "same" | "different" | "identity" | "zero" = "same";
		const client: PostgresqlRunOperationsSqlClient = {
			transaction: async (work) =>
				work({
					query: async (sql) => {
						if (sql.includes("SELECT request FROM inserted")) return { rows: [] };
						if (sql.includes("SELECT recovery_id,body_fingerprint"))
							return mode === "identity"
								? { rows: [] }
								: {
										rows: [
											{
												recovery_id: original.recoveryId,
												body_fingerprint: mode === "same" ? fp : "different",
												request: original,
											},
										],
									};
						if (sql.includes("WHERE recovery_id=$1 FOR UPDATE"))
							return { rows: [{ body_fingerprint: fp }] };
						if (mode === "zero") return { rows: [] };
						throw new Error(`unexpected SQL: ${sql}`);
					},
				}),
			close: vi.fn(),
		};
		const store = postgresql16RunOperationsStore(client);
		expect(await store.record(original)).toMatchObject({
			accepted: true,
			code: "idempotent-rereference",
		});
		mode = "different";
		expect(await store.record(original)).toEqual({ accepted: false, code: "idempotency-conflict" });
		mode = "identity";
		expect(await store.record({ ...original, idempotencyKey: "other-key" })).toEqual({
			accepted: false,
			code: "recovery-identity-conflict",
		});
		mode = "zero";
		expect(await store.admit(original, truth(), 200)).toEqual({
			accepted: false,
			code: "cas-rejected",
		});
	});
	it("rejects hostile nested admission and materialization rows from the SQL boundary", async () => {
		const r = request(),
			canonical = postgresqlRunOperationMaterialization(r, truth(), 200);
		let hostile: "admission" | "materialization" = "admission";
		const client: PostgresqlRunOperationsSqlClient = {
			transaction: async (work) =>
				work({
					query: async () => ({
						rows: [
							{
								result:
									hostile === "admission"
										? {
												accepted: true,
												code: "x",
												admission: {
													kind: "postgresql-run-operation-admission",
													recoveryId: r.recoveryId,
													state: "admitted",
													code: "x",
													bodyFingerprint: "fp",
													decidedAtMs: 200,
													auditRefs: [],
													rawSql: "secret",
												},
											}
										: {
												accepted: true,
												code: "x",
												materialization: {
													...canonical,
													candidateRequest: {
														...canonical.candidateRequest!,
														metadata: {
															...canonical.candidateRequest!.metadata,
															credential: "secret",
														},
													},
												},
											},
							},
						],
					}),
				}),
			close: vi.fn(),
		};
		const store = postgresql16RunOperationsStore(client);
		await expect(store.admit(r, truth(), 200)).rejects.toThrow("unknown-recovery-field:rawSql");
		hostile = "materialization";
		await expect(store.materialize(r, truth(), canonical, 200)).rejects.toThrow(
			"unknown-recovery-field:credential",
		);
	});
	it("rejects a legal-shaped admission whose audit refs differ from the internal canonical admission", async () => {
		const r = request(),
			fp = postgresqlRunOperationBodyFingerprint(r);
		const client: PostgresqlRunOperationsSqlClient = {
			transaction: async (work) =>
				work({
					query: async () => ({
						rows: [
							{
								result: {
									accepted: true,
									code: "admitted",
									admission: {
										kind: "postgresql-run-operation-admission",
										recoveryId: r.recoveryId,
										state: "admitted",
										code: "admitted",
										bodyFingerprint: fp,
										decidedAtMs: 200,
										auditRefs: [{ kind: "postgresql-run-operation-audit", id: "forged" }],
									},
								},
							},
						],
					}),
				}),
			close: vi.fn(),
		};
		await expect(postgresql16RunOperationsStore(client).admit(r, truth(), 200)).rejects.toThrow(
			"store-admission-canonical-mismatch",
		);
	});
	it("creates D358 repair handoff only from a locked accepted ledger materialization", async () => {
		const r = request("repair"),
			m = postgresqlRunOperationMaterialization(r, truth(), 200),
			fp = postgresqlRunOperationBodyFingerprint(r);
		let stored = true;
		const client: PostgresqlRunOperationsSqlClient = {
			transaction: async (work) =>
				work({
					query: async (sql) => {
						expect(sql).toContain("WHERE recovery_id=$1 FOR UPDATE");
						return {
							rows: stored
								? [
										{
											state: "materialized",
											body_fingerprint: fp,
											terminal_high_water: truth().terminalHighWater,
											materialization: m,
										},
									]
								: [],
						};
					},
				}),
			close: vi.fn(),
		};
		const store = postgresql16RunOperationsStore(client);
		expect(await store.repairProposal(r, truth(), 201)).toMatchObject({
			accepted: true,
			code: "repair-proposal-ready",
			proposal: {
				kind: "work-item-domain-action-proposal",
				workItemId: "work-item",
				actionKind: "postgresql-governed-repair",
			},
		});
		stored = false;
		expect(await store.repairProposal(r, truth(), 201)).toEqual({
			accepted: false,
			code: "repair-materialization-missing",
		});
	});
});
