import { describe, expect, it, vi } from "vitest";
import {
	authenticatedOutboundCustomerHostedTransport,
	CUSTOMER_HOSTED_POSTGRESQL_AGENT_PLATFORM,
	CUSTOMER_HOSTED_POSTGRESQL_COMPATIBILITY,
	CUSTOMER_HOSTED_POSTGRESQL_CONTROL_STORE,
	CUSTOMER_HOSTED_POSTGRESQL_PROTOCOL,
	CUSTOMER_HOSTED_POSTGRESQL_SCHEMA_REVISION,
	type CustomerHostedPostgresqlAdmittedEnvelope,
	type CustomerHostedPostgresqlControlStoreDriver,
	type CustomerHostedPostgresqlEnrollment,
	type CustomerHostedPostgresqlLeaseCoordinates,
	type CustomerHostedPostgresqlLifecycleFact,
	type CustomerHostedPostgresqlOutboxEntry,
	type CustomerHostedPostgresqlReadiness,
	type CustomerHostedPostgresqlRelease,
	type CustomerHostedPostgresqlTransportDriver,
	type CustomerHostedPostgresqlWorkerDriver,
	customerHostedPostgresqlAdmittedEnvelopeFromApprovedRun,
	customerHostedPostgresqlEnrollment,
	customerHostedPostgresqlEvidenceOutbox,
	customerHostedPostgresqlReadiness,
	customerHostedPostgresqlRelease,
	customerHostedPostgresqlRuntime,
	customerHostedPostgresqlWorkerExecute,
	postgresql16CustomerHostedControlStore,
} from "../executors/customer-hosted-postgresql.js";
import { Graph } from "../graph/index.js";
import type {
	ExecutorOutcome,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
} from "../orchestration/index.js";

const digest = `sha256:${"a".repeat(64)}` as const;
const keyDigest = `sha256:${"b".repeat(64)}` as const;
const now = 1_000;

const release: CustomerHostedPostgresqlRelease = {
	kind: "customer-hosted-postgresql-release",
	compatibilityRevision: CUSTOMER_HOSTED_POSTGRESQL_COMPATIBILITY,
	platformRevision: CUSTOMER_HOSTED_POSTGRESQL_AGENT_PLATFORM,
	agentRevision: "agent-v1",
	agentDigest: digest,
	signatureIssuerRevision: "issuer-v1",
	signatureRef: { kind: "attestation", id: "signature-1" },
	sbomRef: { kind: "attestation", id: "sbom-1" },
	provenanceRef: { kind: "attestation", id: "provenance-1" },
};

const enrollment: CustomerHostedPostgresqlEnrollment = {
	kind: "customer-hosted-postgresql-enrollment",
	tenantId: "tenant-1",
	endpointId: "endpoint-1",
	enrollmentRevision: "enrollment-v1",
	keyGeneration: 1,
	publicKeyFingerprint: keyDigest,
	agentRevision: "agent-v1",
	agentDigest: digest,
	policyRevision: "policy-v1",
	credentialBindingRevision: "binding-v1",
	state: "active",
	issuedAtMs: 100,
	expiresAtMs: 10_000,
	attestationRefs: [{ kind: "attestation", id: "enrollment-1" }],
};

const readiness: CustomerHostedPostgresqlReadiness = {
	kind: "customer-hosted-postgresql-readiness",
	tenantId: enrollment.tenantId,
	endpointId: enrollment.endpointId,
	enrollmentRevision: enrollment.enrollmentRevision,
	keyGeneration: enrollment.keyGeneration,
	agentRevision: enrollment.agentRevision,
	agentDigest: enrollment.agentDigest,
	state: "ready",
	observedAtMs: 900,
	expiresAtMs: 2_000,
	signatureVerified: true,
	sbomVerified: true,
	provenanceVerified: true,
	serverTrustReady: true,
	outboundTlsReady: true,
	proxyPolicyReady: true,
	firewallPolicyReady: true,
	credentialResolverReady: true,
	artifactIngressReady: true,
	outboxKeyReady: true,
	attestationRefs: [{ kind: "attestation", id: "ready-1" }],
};

const input: ToolProviderAdapterInput = {
	kind: "tool-provider-adapter-input",
	adapterInputId: "input-1",
	status: "ready",
	requestId: "request-1",
	operationId: "operation-1",
	routeId: "route-1",
	executorId: "executor-1",
	profileId: "profile-1",
	toolName: "postgresql.query",
	sourceRefs: [{ kind: "customer-hosted-workload", id: "artifact-workload-1" }],
};

const approved: ToolProviderAdapterRunRequested = {
	kind: "tool-provider-adapter-run-requested",
	runId: "run-1",
	adapterInputId: input.adapterInputId,
	requestId: input.requestId,
	operationId: input.operationId,
	routeId: input.routeId,
	executorId: input.executorId,
	profileId: input.profileId,
	attempt: 1,
	reason: "initial",
	sourceRefs: [{ kind: "tool-provider-run-admission", id: "admission-1" }],
	metadata: {
		executionEnvironmentLocality: "customer-hosted",
		executionEnvironmentBindingKind: "remote-session",
		executionEnvironmentRevision: "environment-v1",
		executionManifestFingerprint: "deployment-v1",
	},
};

const envelope = () =>
	customerHostedPostgresqlAdmittedEnvelopeFromApprovedRun(approved, input, enrollment);
const lease = (
	value: CustomerHostedPostgresqlAdmittedEnvelope = envelope(),
): CustomerHostedPostgresqlLeaseCoordinates & {
	envelope: CustomerHostedPostgresqlAdmittedEnvelope;
	leaseExpiresAtMs: number;
	heartbeatExpiresAtMs: number;
} => ({
	...pins(value),
	leaseId: "lease-1",
	fencingToken: 1,
	sessionEpoch: "epoch-1",
	envelope: value,
	leaseExpiresAtMs: 1_500,
	heartbeatExpiresAtMs: 1_400,
});

function pins(
	value: Pick<
		CustomerHostedPostgresqlAdmittedEnvelope,
		| "tenantId"
		| "endpointId"
		| "enrollmentRevision"
		| "keyGeneration"
		| "agentRevision"
		| "agentDigest"
		| "runId"
		| "attempt"
		| "environmentRevision"
		| "deploymentFingerprint"
	> = envelope(),
) {
	return {
		tenantId: value.tenantId,
		endpointId: value.endpointId,
		enrollmentRevision: value.enrollmentRevision,
		keyGeneration: value.keyGeneration,
		agentRevision: value.agentRevision,
		agentDigest: value.agentDigest,
		runId: value.runId,
		attempt: value.attempt,
		environmentRevision: value.environmentRevision,
		deploymentFingerprint: value.deploymentFingerprint,
	};
}

function life(
	state: CustomerHostedPostgresqlLifecycleFact["state"],
	coordinates = lease(),
): CustomerHostedPostgresqlLifecycleFact {
	return {
		...pins(coordinates),
		leaseId: coordinates.leaseId,
		fencingToken: coordinates.fencingToken,
		sessionEpoch: coordinates.sessionEpoch,
		kind: "customer-hosted-postgresql-lifecycle-fact",
		state,
		occurredAtMs: now,
	};
}

function outcome(
	value = envelope(),
	settlement?: CustomerHostedPostgresqlLeaseCoordinates & {
		settlementId: string;
		issueRefs: readonly { kind: string; id: string }[];
	},
): ExecutorOutcome {
	return {
		kind: "result",
		outcomeId: settlement?.settlementId ?? "settlement-1",
		requestId: value.requestId,
		operationId: value.operationId,
		routeId: value.routeId,
		executorId: value.executorId,
		profileId: value.profileId,
		attempt: value.attempt,
		inputId: value.adapterInputId,
		inputKind: "tool-call",
		result: {
			kind: "customer-hosted-result-refs",
			value: { outcomeRefs: [{ kind: "artifact", id: "result-1" }] },
		},
		metadata: {
			runId: value.runId,
			tenantId: value.tenantId,
			endpointId: value.endpointId,
			enrollmentRevision: value.enrollmentRevision,
			keyGeneration: value.keyGeneration,
			agentRevision: value.agentRevision,
			agentDigest: value.agentDigest,
			leaseId: settlement?.leaseId ?? "lease-1",
			fencingToken: settlement?.fencingToken ?? 1,
			sessionEpoch: settlement?.sessionEpoch ?? "epoch-1",
			issueRefs: settlement?.issueRefs ?? [],
		},
	};
}

describe("D606 customer-hosted PostgreSQL", () => {
	it("strictly snapshots release, enrollment and readiness without runtime-private material", () => {
		expect(customerHostedPostgresqlRelease(release)).toEqual(release);
		expect(customerHostedPostgresqlEnrollment(enrollment)).toEqual(enrollment);
		expect(customerHostedPostgresqlReadiness(readiness)).toEqual(readiness);
		expect(() =>
			customerHostedPostgresqlRelease({
				...release,
				agentDigest: "sha256:mutable" as typeof digest,
			}),
		).toThrow();
		expect(() =>
			customerHostedPostgresqlEnrollment({
				...enrollment,
				password: "bad",
			} as CustomerHostedPostgresqlEnrollment),
		).toThrow();
		expect(JSON.stringify([release, enrollment, readiness])).not.toMatch(
			/privateKey|password|proxyUrl|connectionString/,
		);
	});

	it("derives the immutable queue envelope only from a real D419-approved exact input", () => {
		const value = envelope();
		expect(value).toMatchObject({
			admissionId: "admission-1",
			workloadRef: { id: "artifact-workload-1" },
			tenantId: "tenant-1",
		});
		expect(() =>
			customerHostedPostgresqlAdmittedEnvelopeFromApprovedRun(
				{ ...approved, sourceRefs: [] },
				input,
				enrollment,
			),
		).toThrow();
		expect(() =>
			customerHostedPostgresqlAdmittedEnvelopeFromApprovedRun(
				{ ...approved, requestId: "other" },
				input,
				enrollment,
			),
		).toThrow();
		expect(() =>
			customerHostedPostgresqlAdmittedEnvelopeFromApprovedRun(
				{
					...approved,
					metadata: { ...approved.metadata, executionEnvironmentLocality: "managed-cloud" },
				},
				input,
				enrollment,
			),
		).toThrow();
	});

	it("uses exact PG16 CAS predicates and rejects hostile store output", async () => {
		const queries: Array<{ sql: string; params: readonly unknown[] }> = [];
		const client = {
			query: vi.fn(async (sql: string, params: readonly unknown[]) => {
				queries.push({ sql, params });
				if (sql.startsWith("CREATE")) return { rows: [] };
				return {
					rows: [
						{
							result: {
								accepted: true,
								code: "queued",
								lifecycle: {
									kind: "customer-hosted-postgresql-lifecycle-fact",
									state: "queued",
									...pins(),
									occurredAtMs: now,
								},
							},
						},
					],
				};
			}),
		};
		const store = postgresql16CustomerHostedControlStore(client);
		await store.admit(envelope(), now);
		expect(queries.map((q) => q.sql).join(" ")).toContain("policy_revision");
		expect(queries.map((q) => q.sql).join(" ")).toContain("deployment_fingerprint");
		expect(String(queries.at(-1)?.params[4])).toContain("admission-1");
		const hostile = postgresql16CustomerHostedControlStore({
			query: async () => ({
				rows: [{ result: { accepted: true, code: "claimed", lease: { socket: {} } } }],
			}),
		});
		await expect(
			hostile.claim(
				{
					kind: "claim",
					messageId: "claim-1",
					tenantId: enrollment.tenantId,
					endpointId: enrollment.endpointId,
					enrollmentRevision: enrollment.enrollmentRevision,
					keyGeneration: 1,
					agentRevision: enrollment.agentRevision,
					agentDigest: enrollment.agentDigest,
					sessionEpoch: "epoch-1",
					authAttestationRef: { kind: "attestation", id: "auth-1" },
				},
				enrollment,
				now,
			),
		).rejects.toThrow();
		const hostileOutcome = postgresql16CustomerHostedControlStore({
			query: async () => ({
				rows: [
					{
						result: {
							accepted: true,
							code: "settled",
							lifecycle: life("settled"),
							outcome: { ...outcome(), rawSql: "select forbidden" },
						},
					},
				],
			}),
		});
		await expect(
			hostileOutcome.settle(
				{
					kind: "settle",
					messageId: "settle-hostile",
					settlementId: "settlement-1",
					outcome: "succeeded",
					outcomeRefs: [],
					issueRefs: [],
					...lease(),
				},
				now,
			),
		).rejects.toThrow(/Unexpected fields|private/i);
	});

	it("pins every PG16 mutation and returns canonical material only through CAS", async () => {
		const sql: string[] = [];
		const store = postgresql16CustomerHostedControlStore({
			query: async (text) => {
				sql.push(text);
				return { rows: [] };
			},
		});
		const exact = lease();
		await store.upsertEnrollment(enrollment, now);
		await store.claim(
			{
				kind: "claim",
				messageId: "claim-sql",
				tenantId: enrollment.tenantId,
				endpointId: enrollment.endpointId,
				enrollmentRevision: enrollment.enrollmentRevision,
				keyGeneration: enrollment.keyGeneration,
				agentRevision: enrollment.agentRevision,
				agentDigest: enrollment.agentDigest,
				sessionEpoch: exact.sessionEpoch,
				authAttestationRef: { kind: "attestation", id: "auth-sql" },
			},
			enrollment,
			now,
		);
		await store.heartbeat({ kind: "heartbeat", messageId: "heartbeat-1", ...exact }, 1_200, now);
		await store.persistCancellation(
			{
				kind: "customer-hosted-postgresql-cancellation-requested",
				cancellationId: "cancel-1",
				...exact,
			},
			now,
		);
		await store.acknowledgeCancellation(
			{ kind: "cancel-ack", messageId: "ack-1", cancellationId: "cancel-1", ...exact },
			now,
		);
		await store.settle(
			{
				kind: "settle",
				messageId: "settle-1",
				settlementId: "settlement-1",
				outcome: "succeeded",
				outcomeRefs: [],
				issueRefs: [],
				...exact,
			},
			now,
		);
		await store.disconnect(exact.tenantId, exact.endpointId, exact.sessionEpoch, now);
		await store.revoke(enrollment, now);
		await store.expire(now);
		const mutations = sql.join("\n");
		for (const column of [
			"tenant_id",
			"endpoint_id",
			"run_id",
			"attempt",
			"enrollment_revision",
			"key_generation",
			"agent_revision",
			"agent_digest",
			"lease_id",
			"fencing_token",
			"session_epoch",
			"environment_revision",
			"deployment_fingerprint",
		])
			expect(mutations).toContain(column);
		expect(mutations).toContain("lease_expires_at_ms>");
		expect(mutations).toContain("graphrefly_customer_endpoint_v1");
		expect(mutations).toContain("graphrefly_customer_endpoint_head_v1");
		expect(mutations).toContain("PRIMARY KEY (tenant_id,endpoint_id,key_generation)");
		expect(mutations).toContain(
			"graphrefly_customer_endpoint_v1.enrollment_revision=EXCLUDED.enrollment_revision",
		);
		expect(mutations).toContain(
			"graphrefly_customer_endpoint_v1.agent_digest=EXCLUDED.agent_digest",
		);
		expect(mutations).toContain(
			"graphrefly_customer_endpoint_v1.state='active' AND EXCLUDED.state IN ('draining','revoked')",
		);
		expect(mutations).not.toContain(
			"graphrefly_customer_endpoint_v1.state='revoked' AND EXCLUDED.state='active'",
		);
		expect(mutations).toContain("e.state='active'");
		expect(mutations).toContain("e.expires_at_ms>");
		expect(mutations).toContain(
			"graphrefly_customer_endpoint_head_v1.current_key_generation<=EXCLUDED.current_key_generation",
		);
		expect(mutations).toContain("h.current_key_generation=$7");
		expect(mutations).toContain("FOR UPDATE OF h,q,e");
		expect(mutations).toContain("customer-hosted-postgresql-lifecycle-fact");
		expect(mutations).toContain("customer-hosted-result-refs");
	});

	it("serializes concurrent evidence admission across duplicate, count, and byte bounds", async () => {
		const values: CustomerHostedPostgresqlOutboxEntry[] = [];
		let storeTail = Promise.resolve();
		const store = {
			encryptionRevision: "encryption-v1",
			encryptionReady: async () => true,
			putEncryptedIfWithinBounds: (
				value: CustomerHostedPostgresqlOutboxEntry,
				maxEntries: number,
				maxBytes: number,
			) => {
				const operation = storeTail.then(async () => {
					await tick();
					if (values.some((entry) => entry.evidenceId === value.evidenceId))
						return "duplicate" as const;
					if (
						values.length >= maxEntries ||
						new TextEncoder().encode(JSON.stringify([...values, value])).byteLength > maxBytes
					)
						return "full" as const;
					values.push(value);
					return "stored" as const;
				});
				storeTail = operation.then(() => undefined);
				return operation;
			},
			listEncrypted: async () => [...values],
			removeEncrypted: async () => {},
			clear: async () => {
				values.length = 0;
			},
		};
		const base: CustomerHostedPostgresqlOutboxEntry = {
			kind: "customer-hosted-postgresql-offline-evidence",
			evidenceId: "race-1",
			terminalPosture: "lost",
			occurredAtMs: now,
			issueRefs: [],
			artifactRefs: [],
			...pins(),
		};
		const duplicateBox = customerHostedPostgresqlEvidenceOutbox(
			store,
			{ encryptionRevision: "encryption-v1", maxEntries: 2, maxBytes: 8_000, maxAgeMs: 100 },
			() => now,
		);
		const secondOwner = customerHostedPostgresqlEvidenceOutbox(
			store,
			{ encryptionRevision: "encryption-v1", maxEntries: 2, maxBytes: 8_000, maxAgeMs: 100 },
			() => now,
		);
		const duplicate = await Promise.allSettled([
			duplicateBox.enqueue(base),
			secondOwner.enqueue(base),
		]);
		expect(duplicate.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(values).toHaveLength(1);

		const second = { ...base, evidenceId: "race-2" };
		const third = { ...base, evidenceId: "race-3" };
		const count = await Promise.allSettled([
			duplicateBox.enqueue(second),
			secondOwner.enqueue(third),
		]);
		expect(count.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(values).toHaveLength(2);

		await duplicateBox.dispose();
		const oneEntryBytes = new TextEncoder().encode(JSON.stringify([base])).byteLength;
		const byteBox = customerHostedPostgresqlEvidenceOutbox(
			store,
			{
				encryptionRevision: "encryption-v1",
				maxEntries: 3,
				maxBytes: oneEntryBytes,
				maxAgeMs: 100,
			},
			() => now,
		);
		const bytes = await Promise.allSettled([byteBox.enqueue(base), byteBox.enqueue(second)]);
		expect(bytes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(values).toHaveLength(1);
	});

	it("keeps the encrypted evidence outbox bounded, deduplicated, expiring and noncanonical", async () => {
		const values: CustomerHostedPostgresqlOutboxEntry[] = [];
		const store = {
			encryptionRevision: "encryption-v1",
			encryptionReady: vi.fn(() => true),
			putEncryptedIfWithinBounds: async (
				v: CustomerHostedPostgresqlOutboxEntry,
				maxEntries: number,
				maxBytes: number,
			) => {
				if (values.some((entry) => entry.evidenceId === v.evidenceId)) return "duplicate" as const;
				if (
					values.length >= maxEntries ||
					new TextEncoder().encode(JSON.stringify([...values, v])).byteLength > maxBytes
				)
					return "full" as const;
				values.push(v);
				return "stored" as const;
			},
			listEncrypted: async () => values,
			removeEncrypted: async (id: string) => {
				const i = values.findIndex((v) => v.evidenceId === id);
				if (i >= 0) values.splice(i, 1);
			},
			clear: async () => {
				values.length = 0;
			},
		};
		let clock = now;
		const box = customerHostedPostgresqlEvidenceOutbox(
			store,
			{ encryptionRevision: "encryption-v1", maxEntries: 2, maxBytes: 8_000, maxAgeMs: 100 },
			() => clock,
		);
		const entry: CustomerHostedPostgresqlOutboxEntry = {
			kind: "customer-hosted-postgresql-offline-evidence",
			evidenceId: "evidence-1",
			terminalPosture: "lost",
			occurredAtMs: now,
			issueRefs: [],
			artifactRefs: [],
			...pins(),
		};
		expect(await box.enqueue(entry)).toMatchObject({ state: "locally-buffered" });
		await expect(box.enqueue(entry)).rejects.toThrow(/Duplicate/);
		await expect(
			box.enqueue({
				...entry,
				evidenceId: "evidence-extra",
				extra: true,
			} as CustomerHostedPostgresqlOutboxEntry),
		).rejects.toThrow(/Unexpected fields/);
		clock = 1_101;
		expect(
			await box.flush(async () => {
				throw new Error("expired evidence must not upload");
			}),
		).toMatchObject([{ state: "expired" }]);
		store.encryptionReady.mockReturnValue(false);
		await expect(
			box.enqueue({ ...entry, evidenceId: "evidence-2", occurredAtMs: clock }),
		).rejects.toThrow(/encryption/);
	});

	it("authenticates one exact outbound session and never sends across an old epoch", async () => {
		let message: ((value: unknown) => void) | undefined;
		let close: (() => void) | undefined;
		const send = vi.fn();
		const transport = authenticatedOutboundCustomerHostedTransport(
			{
				connect: async () => ({
					tenantId: "tenant-1",
					endpointId: "endpoint-1",
					sessionEpoch: "epoch-1",
					onMessage: (cb) => {
						message = cb;
					},
					onClose: (cb) => {
						close = cb;
					},
					send,
					close: vi.fn(),
				}),
			},
			{ verifyServer: () => true, verifyEnrollment: () => true },
			"server-v1",
		);
		const received: unknown[] = [];
		const disconnected = vi.fn();
		await transport.start((v) => received.push(v), disconnected);
		message?.({ kind: "heartbeat" });
		expect(received).toHaveLength(1);
		await transport.send("tenant-1", "endpoint-1", "epoch-1", {
			kind: "rejected",
			messageId: "m-1",
			operation: "claim",
			code: "no",
		});
		await expect(
			transport.send("tenant-1", "endpoint-1", "epoch-old", {
				kind: "rejected",
				messageId: "m-2",
				operation: "claim",
			}),
		).rejects.toThrow(/exact current/);
		close?.();
		close?.();
		expect(disconnected).toHaveBeenCalledTimes(1);
	});

	it("derives settlement from the customer-local driver and exposes no credential value", async () => {
		const driver: CustomerHostedPostgresqlWorkerDriver = {
			execute: vi.fn(async ({ credentialBindingRevision }) => ({
				outcome: "succeeded",
				outcomeRefs: [{ kind: "artifact", id: `result-${credentialBindingRevision}` }],
				issueRefs: [],
			})),
			stop: vi.fn(),
			kill: vi.fn(),
			close: vi.fn(),
		};
		const value = await customerHostedPostgresqlWorkerExecute(
			{ kind: "claim-granted", messageId: "claim-1", ...lease() },
			driver,
			"settlement-1",
		);
		expect(value).toMatchObject({
			outcome: "succeeded",
			tenantId: "tenant-1",
			sessionEpoch: "epoch-1",
		});
		expect(JSON.stringify(value)).not.toMatch(/password|connectionString|privateKey/);
	});

	it("runs admitted work once, rejects direct settlement, fences revoke, and releases topology", async () => {
		const g = new Graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "inputs" });
		const approvedRuns = g.node<ToolProviderAdapterRunRequested>([], null, { name: "approved" });
		const releases = g.node<CustomerHostedPostgresqlRelease>([], null, { name: "releases" });
		const enrollments = g.node<CustomerHostedPostgresqlEnrollment>([], null, {
			name: "enrollments",
		});
		const postures = g.node<CustomerHostedPostgresqlReadiness>([], null, { name: "postures" });
		const before = g.topology();
		let admitted: CustomerHostedPostgresqlAdmittedEnvelope | undefined;
		let currentLease: ReturnType<typeof lease> | undefined;
		let revoked = false;
		const revokeOrder: string[] = [];
		let acceptEnrollment = false;
		const store: CustomerHostedPostgresqlControlStoreDriver = {
			compatibility: CUSTOMER_HOSTED_POSTGRESQL_CONTROL_STORE,
			schemaRevision: CUSTOMER_HOSTED_POSTGRESQL_SCHEMA_REVISION,
			upsertEnrollment: async () => ({
				accepted: acceptEnrollment,
				code: acceptEnrollment ? "enrollment-current" : "enrollment-stale",
			}),
			admit: async (e) => {
				admitted = e;
				return { accepted: true, code: "queued", lifecycle: life("queued", { ...lease(e) }) };
			},
			claim: async () => {
				currentLease = lease(admitted);
				return {
					accepted: true,
					code: "claimed",
					lease: currentLease,
					lifecycle: life("claimed", currentLease),
				};
			},
			heartbeat: async (m) => ({
				accepted: true,
				code: "heartbeat-current",
				lifecycle: life("heartbeat-current", m),
			}),
			persistCancellation: async (m) => ({
				accepted: true,
				code: "cancel-pending",
				lifecycle: life("cancel-pending", m),
			}),
			acknowledgeCancellation: async (m) => ({
				accepted: true,
				code: "cancel-acknowledged",
				lifecycle: life("cancel-acknowledged", m),
			}),
			settle: async (m) =>
				revoked
					? { accepted: false, code: "revoked-fence" }
					: {
							accepted: true,
							code: "settled",
							lifecycle: life("settled", m),
							outcome: outcome(admitted, m),
						},
			acceptOfflineEvidence: async () => ({ accepted: false, code: "not-current" }),
			revoke: async () => {
				revokeOrder.push("fence");
				revoked = true;
				return currentLease
					? [life("revoked", { ...currentLease, fencingToken: currentLease.fencingToken + 1 })]
					: [];
			},
			disconnect: async () => [life("lost")],
			expire: async () => [],
			close: vi.fn(),
		};
		let onMessage: ((value: unknown) => void) | undefined;
		const transport: CustomerHostedPostgresqlTransportDriver = {
			protocolRevision: CUSTOMER_HOSTED_POSTGRESQL_PROTOCOL,
			start: (cb) => {
				onMessage = cb;
			},
			send: vi.fn(),
			close: vi.fn(),
		};
		const execute = vi.fn(
			async () =>
				({
					outcome: "succeeded",
					outcomeRefs: [{ kind: "artifact", id: "result-1" }],
					issueRefs: [],
				}) as Promise<{
					outcome: "succeeded";
					outcomeRefs: { kind: string; id: string }[];
					issueRefs: never[];
				}>,
		);
		const driver: CustomerHostedPostgresqlWorkerDriver = {
			execute,
			stop: vi.fn(() => {
				revokeOrder.push("stop");
			}),
			kill: vi.fn(),
			close: vi.fn(),
		};
		const verifyEnrollment = vi.fn(() => true);
		const runtime = customerHostedPostgresqlRuntime(g, {
			inputs,
			approvedRunRequestNodes: [approvedRuns],
			releaseNodes: [releases],
			enrollmentNodes: [enrollments],
			readinessNodes: [postures],
			store,
			transport,
			trust: { verifyServer: () => true, verifyEnrollment },
			workerDriver: driver,
			now: () => now,
		});
		const issues: unknown[] = [],
			outcomes: unknown[] = [];
		const unsubscribeIssues = runtime.issues.subscribe((m) => {
			if (m[0] === "DATA") issues.push(m[1]);
		});
		const unsubscribeOutcomes = runtime.outcomes.subscribe((m) => {
			if (m[0] === "DATA") outcomes.push(m[1]);
		});
		inputs.down([["DATA", input]]);
		approvedRuns.down([["DATA", approved]]);
		await tick();
		expect(admitted).toBeUndefined();
		releases.down([["DATA", release]]);
		enrollments.down([["DATA", enrollment]]);
		postures.down([["DATA", readiness]]);
		approvedRuns.down([["DATA", approved]]);
		await tick();
		expect(admitted).toBeUndefined();
		expect(verifyEnrollment).not.toHaveBeenCalled();
		acceptEnrollment = true;
		enrollments.down([["DATA", enrollment]]);
		approvedRuns.down([["DATA", approved]]);
		await tick();
		onMessage?.({
			kind: "claim",
			messageId: "stale-claim",
			tenantId: "other-tenant",
			endpointId: enrollment.endpointId,
			enrollmentRevision: enrollment.enrollmentRevision,
			keyGeneration: 1,
			agentRevision: enrollment.agentRevision,
			agentDigest: enrollment.agentDigest,
			sessionEpoch: "epoch-1",
			authAttestationRef: { kind: "attestation", id: "auth-stale" },
		});
		await tick();
		expect(verifyEnrollment).not.toHaveBeenCalled();
		expect(driver.execute).not.toHaveBeenCalled();
		onMessage?.({
			kind: "claim",
			messageId: "claim-1",
			tenantId: enrollment.tenantId,
			endpointId: enrollment.endpointId,
			enrollmentRevision: enrollment.enrollmentRevision,
			keyGeneration: 1,
			agentRevision: enrollment.agentRevision,
			agentDigest: enrollment.agentDigest,
			sessionEpoch: "epoch-1",
			authAttestationRef: { kind: "attestation", id: "auth-1" },
		});
		await tick();
		await tick();
		expect(verifyEnrollment).toHaveBeenCalledTimes(1);
		expect(driver.execute).toHaveBeenCalledTimes(1);
		expect(outcomes, JSON.stringify(issues)).toHaveLength(1);
		onMessage?.({
			kind: "settle",
			messageId: "forged",
			settlementId: "forged",
			outcome: "succeeded",
			outcomeRefs: [],
			issueRefs: [],
			...pins(),
			leaseId: "lease-1",
			fencingToken: 1,
			sessionEpoch: "epoch-1",
		});
		await tick();
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "customer-hosted-direct-settlement-rejected" }),
			]),
		);
		let resolveSecond:
			| ((value: { outcome: "canceled"; outcomeRefs: never[]; issueRefs: never[] }) => void)
			| undefined;
		execute.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveSecond = resolve;
				}),
		);
		approvedRuns.down([["DATA", { ...approved, runId: "run-2" }]]);
		await tick();
		onMessage?.({
			kind: "claim",
			messageId: "claim-2",
			tenantId: enrollment.tenantId,
			endpointId: enrollment.endpointId,
			enrollmentRevision: enrollment.enrollmentRevision,
			keyGeneration: 1,
			agentRevision: enrollment.agentRevision,
			agentDigest: enrollment.agentDigest,
			sessionEpoch: "epoch-1",
			authAttestationRef: { kind: "attestation", id: "auth-2" },
		});
		await tick();
		expect(execute).toHaveBeenCalledTimes(2);
		enrollments.down([["DATA", { ...enrollment, state: "revoked" }]]);
		await tick();
		expect(driver.stop).toHaveBeenCalled();
		resolveSecond?.({ outcome: "canceled", outcomeRefs: [], issueRefs: [] });
		await tick();
		expect(outcomes).toHaveLength(1);
		expect(revokeOrder.slice(-2)).toEqual(["fence", "stop"]);
		const during = g.topology();
		const beforeNames = new Set(before.nodes.map((n) => n.name));
		const added = during.nodes.filter((n) => !beforeNames.has(n.name));
		expect(
			added
				.map(({ name, factory, deps }) => ({ name, factory, deps }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		).toEqual([
			{
				name: "customerHostedPostgresql/admittedEnvelopes",
				factory: "customerHostedPostgresqlAdmittedEnvelopes",
				deps: [],
			},
			{
				name: "customerHostedPostgresql/audit",
				factory: "customerHostedPostgresqlAudit",
				deps: [],
			},
			{
				name: "customerHostedPostgresql/cancellations",
				factory: "customerHostedPostgresqlCancellations",
				deps: [],
			},
			{
				name: "customerHostedPostgresql/issues",
				factory: "customerHostedPostgresqlIssues",
				deps: [],
			},
			{
				name: "customerHostedPostgresql/lifecycle",
				factory: "customerHostedPostgresqlLifecycle",
				deps: [],
			},
			{
				name: "customerHostedPostgresql/outcomes",
				factory: "customerHostedPostgresqlOutcomes",
				deps: [],
			},
		]);
		expect(
			during.edges.filter((e) => !before.edges.some((b) => b.from === e.from && b.to === e.to)),
		).toEqual([]);
		expect(JSON.stringify(g.topology())).not.toMatch(/password|socket|privateKey|connectionString/);
		unsubscribeIssues();
		unsubscribeOutcomes();
		await runtime.dispose();
		await runtime.dispose();
		expect(transport.close).toHaveBeenCalledTimes(1);
		expect(g.topology()).toEqual(before);
	});
});

async function tick() {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
