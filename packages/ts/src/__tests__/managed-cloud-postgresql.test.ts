import { describe, expect, it } from "vitest";
import {
	authenticatedWssManagedCloudTransport,
	executeManagedCloudPostgresqlClaim,
	MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
	MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE,
	MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
	MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION,
	type ManagedCloudPostgresqlControlMessage,
	type ManagedCloudPostgresqlControlStoreDriver,
	type ManagedCloudPostgresqlLifecycleFact,
	type ManagedCloudPostgresqlManifest,
	type ManagedCloudPostgresqlReadiness,
	type ManagedCloudPostgresqlSqlClient,
	type ManagedCloudPostgresqlStoreResult,
	type ManagedCloudPostgresqlTransportDriver,
	type ManagedCloudPostgresqlWorkerMessage,
	managedCloudPostgresqlManifest,
	managedCloudPostgresqlReadiness,
	managedCloudPostgresqlRuntime,
	postgresql16ManagedCloudControlStore,
} from "../executors/managed-cloud-postgresql.js";
import { postgresqlToolProviderInputFromIntent } from "../executors/postgresql-tool-provider.js";
import { graph } from "../graph/graph.js";
import type { ExecutorOutcome, ToolProviderAdapterRunRequested } from "../orchestration/index.js";

const manifest = (): ManagedCloudPostgresqlManifest =>
	managedCloudPostgresqlManifest({
		kind: "managed-cloud-postgresql-manifest",
		manifestId: "manifest:cloud:pg",
		revision: "revision:1",
		fingerprint: "fingerprint:cloud:pg:1",
		compatibilityRevision: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
		controlStoreCompatibility: MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE,
		controlStoreSchemaRevision: MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION,
		workerProtocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
		recipeRevision: "postgresql-read-only-query-v1",
		queuePolicyRevision: "queue:fifo:1",
		leasePolicyRevision: "lease:1",
		credentialBindingRevision: "credential-binding:1",
		deploymentRevision: "deployment:1",
		workerRevision: "worker-runtime:1",
		leaseDurationMs: 1000,
		heartbeatDurationMs: 500,
		attestationRefs: [{ kind: "attestation", id: "attestation:cloud:1" }],
	});
const readiness = (
	patch: Partial<ManagedCloudPostgresqlReadiness> = {},
): ManagedCloudPostgresqlReadiness =>
	managedCloudPostgresqlReadiness({
		kind: "managed-cloud-postgresql-readiness",
		manifestFingerprint: "fingerprint:cloud:pg:1",
		state: "ready",
		observedAtMs: 1,
		expiresAtMs: 1000,
		controlStoreReachable: true,
		schemaVerified: true,
		transportReady: true,
		workerPoolReady: true,
		quotaReady: true,
		artifactResolverReady: true,
		credentialResolverReady: true,
		attestationRefs: [{ kind: "attestation", id: "attestation:ready:1" }],
		...patch,
	});
const run = (): ToolProviderAdapterRunRequested => ({
	kind: "tool-provider-adapter-run-requested",
	runId: "run:1",
	adapterInputId: input().adapterInputId,
	requestId: "request:1",
	operationId: "operation:1",
	routeId: "route:1",
	providerId: "postgresql",
	executorId: "executor:pg",
	profileId: "profile:pg",
	attempt: 1,
	reason: "manual",
	metadata: {
		executionEnvironmentId: "environment:managed",
		executionEnvironmentRevision: "environment-revision:1",
		executionEnvironmentLocality: "managed-cloud",
		executionEnvironmentBindingKind: "remote-session",
		executionSessionEpoch: "epoch:admission:1",
		executionManifestFingerprint: "fingerprint:cloud:pg:1",
	},
});
const input = () =>
	postgresqlToolProviderInputFromIntent(
		{
			contractVersion: "1",
			intentId: "intent:1",
			idempotencyKey: "idem:1",
			source: { id: "source:1", revision: "r:1" },
			sourceProfile: { id: "source-profile:1", revision: "r:1" },
			queryPlan: { id: "plan:1", revision: "r:1" },
			executorProfile: { id: "profile-ref:1", revision: "r:1" },
			schemaRef: "schema:1",
		},
		{
			requestId: "request:1",
			operationId: "operation:1",
			effectRunId: "effect:1",
			routeId: "route:1",
			executorId: "executor:pg",
			profileId: "profile:pg",
		},
	);
const lease = {
	runId: "run:1",
	attempt: 1,
	environmentRevision: "environment-revision:1",
	manifestFingerprint: "fingerprint:cloud:pg:1",
	leaseId: "lease:1",
	fencingToken: 1,
	workerId: "worker:1",
	sessionEpoch: "epoch:worker:1",
	deploymentRevision: "deployment:1",
	workerRevision: "worker-runtime:1",
} as const;
const lifecycle = (
	state: ManagedCloudPostgresqlLifecycleFact["state"],
): ManagedCloudPostgresqlLifecycleFact => ({
	kind: "managed-cloud-postgresql-lifecycle-fact",
	state,
	runId: "run:1",
	attempt: 1,
	leaseId: "lease:1",
	fencingToken: 1,
	workerId: "worker:1",
	sessionEpoch: "epoch:worker:1",
	environmentRevision: "environment-revision:1",
	manifestFingerprint: "fingerprint:cloud:pg:1",
	deploymentRevision: "deployment:1",
	workerRevision: "worker-runtime:1",
	occurredAtMs: 10,
});

class Store implements ManagedCloudPostgresqlControlStoreDriver {
	readonly compatibility = MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE;
	readonly schemaRevision = MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION;
	calls: string[] = [];
	envelope?: Parameters<ManagedCloudPostgresqlControlStoreDriver["admit"]>[0];
	async admit(envelope: Parameters<ManagedCloudPostgresqlControlStoreDriver["admit"]>[0]) {
		this.calls.push("admit");
		this.envelope = envelope;
		return { accepted: true, code: "admitted", lifecycle: lifecycle("queued") };
	}
	async claim() {
		this.calls.push("claim");
		return {
			accepted: true,
			code: "claimed",
			lifecycle: lifecycle("claimed"),
			lease: {
				...lease,
				envelope: this.envelope!,
				leaseExpiresAtMs: 1010,
				heartbeatExpiresAtMs: 510,
			},
		};
	}
	async heartbeat(input: Parameters<ManagedCloudPostgresqlControlStoreDriver["heartbeat"]>[0]) {
		this.calls.push(`heartbeat:${input.fencingToken}`);
		return input.fencingToken === 1
			? { accepted: true, code: "renewed", lifecycle: lifecycle("heartbeat-current") }
			: { accepted: false, code: "stale-fence" };
	}
	async persistCancellation() {
		this.calls.push("persist-cancel");
		return { accepted: true, code: "cancel-persisted", lifecycle: lifecycle("cancel-pending") };
	}
	async acknowledgeCancellation() {
		this.calls.push("cancel-ack");
		return { accepted: true, code: "cancel-ack", lifecycle: lifecycle("cancel-acknowledged") };
	}
	async settle(
		input: Parameters<ManagedCloudPostgresqlControlStoreDriver["settle"]>[0],
	): Promise<ManagedCloudPostgresqlStoreResult> {
		this.calls.push(`settle:${input.settlementId}`);
		const base = {
			outcomeId: "outcome:1",
			executorId: "executor:pg",
			profileId: "profile:pg",
			requestId: "request:1",
			operationId: "operation:1",
			routeId: "route:1",
			attempt: 1,
			inputId: this.envelope!.adapterInputId,
			inputKind: "tool-call" as const,
			metadata: {
				runId: input.runId,
				sessionEpoch: input.sessionEpoch,
				fencingToken: input.fencingToken,
				issueRefs: input.issueRefs,
			},
			evidenceRefs: input.outcomeRefs,
		};
		const outcome: ExecutorOutcome =
			input.outcome === "succeeded"
				? {
						...base,
						kind: "result",
						result: {
							kind: "managed-cloud-result-refs",
							value: { outcomeRefs: input.outcomeRefs },
						},
					}
				: input.outcome === "failed"
					? {
							...base,
							kind: "failure",
							error: {
								kind: "issue",
								code: "managed-cloud-worker-failure",
								message: "Managed-cloud worker reported failure.",
								severity: "error",
								sourceRefs: input.issueRefs,
							},
							retryable: false,
						}
					: { ...base, kind: "canceled", reason: "admitted-managed-cloud-cancellation" };
		return {
			accepted: true,
			code: "settled",
			lifecycle: lifecycle("settled"),
			outcome,
		};
	}
	async expire() {
		this.calls.push("expire");
		return [{ ...lifecycle("expired"), fencingToken: 2 }];
	}
	async disconnect() {
		this.calls.push("disconnect");
		return [{ ...lifecycle("lost"), fencingToken: 2 }];
	}
	async close() {
		this.calls.push("close");
	}
}
class Transport implements ManagedCloudPostgresqlTransportDriver {
	readonly protocolRevision = MANAGED_CLOUD_POSTGRESQL_PROTOCOL;
	sent: ManagedCloudPostgresqlControlMessage[] = [];
	onMessage?: (message: unknown) => void;
	onDisconnect?: (workerId: string, epoch: string) => void;
	async start(
		onMessage: (message: unknown) => void,
		onDisconnect: (workerId: string, epoch: string) => void,
	) {
		this.onMessage = onMessage;
		this.onDisconnect = onDisconnect;
	}
	async send(_workerId: string, _epoch: string, message: ManagedCloudPostgresqlControlMessage) {
		this.sent.push(message);
	}
	async close() {}
}
const collect = <T>(node: {
	subscribe(cb: (m: readonly [string, unknown]) => void): () => void;
}) => {
	const values: T[] = [];
	node.subscribe((m) => {
		if (m[0] === "DATA") values.push(m[1] as T);
	});
	return values;
};
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("managed-cloud PostgreSQL control plane (D605)", () => {
	it("strictly rejects private or incompatible manifest/readiness material", () => {
		expect(() =>
			managedCloudPostgresqlManifest({ ...manifest(), connectionString: "secret" } as never),
		).toThrow(/unsupported/);
		expect(() =>
			managedCloudPostgresqlManifest({
				...manifest(),
				controlStoreSchemaRevision: "latest",
			} as never),
		).toThrow(/compatibility/);
		expect(() => managedCloudPostgresqlReadiness({ ...readiness(), expiresAtMs: 0 })).toThrow();
		expect(() =>
			managedCloudPostgresqlReadiness({ ...readiness(), token: "secret" } as never),
		).toThrow(/unsupported/);
	});

	it("admits only a fresh D419 managed remote run, then atomically claims with a fresh fenced session", async () => {
		const g = graph();
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedCloudPostgresqlManifest>([], null);
		const postures = g.node<ManagedCloudPostgresqlReadiness>([], null);
		const store = new Store();
		const transport = new Transport();
		const runtime = managedCloudPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			store,
			transport,
			now: () => 10,
		});
		const envelopes = collect(runtime.admittedEnvelopes);
		const admissionIssues = collect(runtime.issues);
		const facts = collect<ManagedCloudPostgresqlLifecycleFact>(runtime.lifecycle);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(envelopes, JSON.stringify(admissionIssues)).toEqual([
			expect.objectContaining({
				runId: "run:1",
				credentialBindingRevision: "credential-binding:1",
				deploymentRevision: "deployment:1",
				workerRevision: "worker-runtime:1",
			}),
		]);
		transport.onMessage?.({
			kind: "claim",
			messageId: "message:claim:1",
			protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			workerId: "worker:1",
			sessionEpoch: "epoch:worker:1",
			environmentRevision: "environment-revision:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:1" },
		});
		await settle();
		expect(store.calls).toEqual(["admit", "claim"]);
		expect(transport.sent).toContainEqual(
			expect.objectContaining({ kind: "claim-granted", leaseId: "lease:1", fencingToken: 1 }),
		);
		expect(facts.map((f) => f.state)).toEqual(["queued", "claimed"]);
		expect(
			JSON.stringify({ envelopes, facts, sent: transport.sent, topology: g.topology() }),
		).not.toMatch(/connectionString|password|secret-value|socketHandle/);
		await runtime.dispose();
	});

	it("renews heartbeat only under the exact fence and visibly rejects stale ownership", async () => {
		const { runtime, transport, store } = await activeRuntime();
		const issues = collect<{ code: string }>(runtime.issues);
		transport.onMessage?.({ kind: "heartbeat", messageId: "message:heartbeat:1", ...lease });
		await settle();
		transport.onMessage?.({
			kind: "heartbeat",
			messageId: "message:heartbeat:stale",
			...lease,
			fencingToken: 2,
		});
		await settle();
		expect(store.calls).toContain("heartbeat:1");
		expect(transport.sent).toContainEqual(
			expect.objectContaining({ kind: "accepted", operation: "heartbeat" }),
		);
		expect(transport.sent).toContainEqual(
			expect.objectContaining({ kind: "rejected", code: "stale-fence" }),
		);
		expect(issues).toContainEqual(expect.objectContaining({ code: "stale-fence" }));
		await runtime.dispose();
	});

	it("persists exact cancellation before delivery and keeps ack separate from terminal settlement", async () => {
		const g = graph();
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedCloudPostgresqlManifest>([], null);
		const postures = g.node<ManagedCloudPostgresqlReadiness>([], null);
		const cancels = g.node([], null);
		const store = new Store();
		const transport = new Transport();
		const runtime = managedCloudPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			cancellationRequests: [cancels as never],
			store,
			transport,
			now: () => 10,
		});
		const states = collect<{ state: string }>(runtime.cancellations);
		const outcomes = collect(runtime.outcomes);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		transport.onMessage?.({
			kind: "claim",
			messageId: "message:cancel-claim:1",
			protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			workerId: "worker:1",
			sessionEpoch: "epoch:worker:1",
			environmentRevision: "environment-revision:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:1" },
		});
		await settle();
		cancels.down([
			[
				"DATA",
				{
					kind: "managed-cloud-postgresql-cancellation-requested",
					cancellationId: "cancel:1",
					...lease,
				},
			],
		]);
		await settle();
		expect(store.calls.indexOf("persist-cancel")).toBeLessThan(
			transport.sent.findIndex((m) => m.kind === "cancel") + store.calls.length,
		);
		expect(states.map((s) => s.state)).toEqual(["persisted-pending", "dispatched-unconfirmed"]);
		const dispatched = transport.sent.filter((message) => message.kind === "cancel").length;
		await runtime.redeliverPendingCancellations();
		expect(transport.sent.filter((message) => message.kind === "cancel")).toHaveLength(
			dispatched + 1,
		);
		transport.onMessage?.({
			kind: "cancel-ack",
			messageId: "message:cancel-ack:1",
			cancellationId: "cancel:1",
			...lease,
		});
		await settle();
		expect(states.at(-1)?.state).toBe("acknowledged");
		expect(outcomes).toHaveLength(0);
		await runtime.dispose();
	});

	it("settles once through store authority and disposes drivers once", async () => {
		const { runtime, transport, store } = await activeRuntime();
		const outcomes = collect(runtime.outcomes);
		const settlementIssues = collect(runtime.issues);
		const facts = collect<ManagedCloudPostgresqlLifecycleFact>(runtime.lifecycle);
		const message: ManagedCloudPostgresqlWorkerMessage = {
			kind: "settle",
			messageId: "message:settle:1",
			settlementId: "settlement:1",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:result:1" }],
			issueRefs: [],
			...lease,
		};
		transport.onMessage?.(message);
		await settle();
		expect(outcomes, JSON.stringify(settlementIssues)).toHaveLength(1);
		expect(facts.map((f) => f.state)).toContain("settled");
		await runtime.dispose();
		await runtime.dispose();
		expect(store.calls.filter((c) => c === "close")).toHaveLength(1);
	});

	it("accepts only incremented-fence terminal facts for an active lease", async () => {
		const disconnected = await activeRuntime();
		const disconnectedFacts = collect(disconnected.runtime.lifecycle);
		disconnected.transport.onDisconnect?.("worker:1", "epoch:worker:1");
		await settle();
		expect(disconnectedFacts.at(-1)).toMatchObject({ state: "lost", fencingToken: 2 });
		await disconnected.runtime.dispose();

		const expired = await activeRuntime();
		const expiredFacts = collect(expired.runtime.lifecycle);
		await expired.runtime.expire();
		expect(expiredFacts.at(-1)).toMatchObject({ state: "expired", fencingToken: 2 });
		await expired.runtime.dispose();
	});

	it("derives settlement only from the private worker driver over the claimed immutable workload", async () => {
		const store = new Store();
		await store.admit(
			{
				...(store.envelope ?? {}),
				kind: "managed-cloud-postgresql-admitted-envelope",
				protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
				runId: "run:1",
				attempt: 1,
				environmentRevision: "environment-revision:1",
				manifestFingerprint: "fingerprint:cloud:pg:1",
				requestId: "request:1",
				operationId: "operation:1",
				routeId: "route:1",
				executorId: "executor:pg",
				profileId: "profile:pg",
				adapterInputId: input().adapterInputId,
				credentialBindingRevision: "credential-binding:1",
				deploymentRevision: "deployment:1",
				workerRevision: "worker-runtime:1",
				workload: input().toolCall!.arguments,
				sourceRefs: [],
			},
			10,
		);
		const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
		const settlement = await executeManagedCloudPostgresqlClaim(
			{ kind: "claim-granted", messageId: "claim:1", ...claim.lease! },
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute(workload, context) {
					expect(workload.schemaRef).toBe("schema:1");
					expect(context.credentialBindingRevision).toBe("credential-binding:1");
					return { outcome: "succeeded", outcomeRefs: [{ kind: "artifact", id: "artifact:1" }] };
				},
			},
			"settlement:worker:1",
			"message:worker:settle:1",
			new AbortController().signal,
		);
		expect(settlement).toMatchObject({
			kind: "settle",
			outcome: "succeeded",
			fencingToken: 1,
			outcomeRefs: [{ id: "artifact:1" }],
		});
	});

	it("fails closed before durable admission for stale readiness or wrong locality", async () => {
		for (const candidate of [
			readiness({ state: "stale" }),
			readiness({ schemaVerified: false }),
			readiness({ credentialResolverReady: false }),
		]) {
			const g = graph();
			const inputs = g.node([], null);
			const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
			const manifests = g.node<ManagedCloudPostgresqlManifest>([], null);
			const postures = g.node<ManagedCloudPostgresqlReadiness>([], null);
			const store = new Store();
			const transport = new Transport();
			const runtime = managedCloudPostgresqlRuntime(g, {
				inputs: inputs as never,
				admittedRunRequests: [admitted],
				manifests: [manifests],
				readiness: [postures],
				store,
				transport,
				now: () => 10,
			});
			const issues = collect<{ code: string }>(runtime.issues);
			inputs.down([["DATA", input()]]);
			manifests.down([["DATA", manifest()]]);
			postures.down([["DATA", candidate]]);
			admitted.down([["DATA", run()]]);
			await settle();
			expect(store.calls).not.toContain("admit");
			expect(issues).toContainEqual(
				expect.objectContaining({ code: "managed-cloud-admission-not-ready" }),
			);
			await runtime.dispose();
		}
	});

	it("rejects malicious store lease material before graph DATA and releases its topology", async () => {
		const store = new Store();
		store.claim = async () => ({
			accepted: true,
			code: "claimed",
			lease: {
				...lease,
				sessionEpoch: "epoch:attacker",
				envelope: store.envelope!,
				leaseExpiresAtMs: 1010,
				heartbeatExpiresAtMs: 510,
			},
		});
		const { runtime, transport, g } = await activeRuntime(store);
		const issues: Array<{ code: string }> = [];
		const unsubscribeIssues = runtime.issues.subscribe((message) => {
			if (message[0] === "DATA") issues.push(message[1] as { code: string });
		});
		transport.onMessage?.({
			kind: "claim",
			messageId: "message:malicious:claim",
			protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			workerId: "worker:1",
			sessionEpoch: "epoch:worker:1",
			environmentRevision: "environment-revision:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:1" },
		});
		await settle();
		expect(transport.sent).not.toContainEqual(expect.objectContaining({ kind: "claim-granted" }));
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "managed-cloud-worker-driver-failed" }),
		);
		const unsubscribe = runtime.outcomes.subscribe(() => {});
		await runtime.dispose();
		expect(g.find("managedCloudPostgresql/outcomes")).toBeDefined();
		unsubscribe();
		unsubscribeIssues();
		await runtime.dispose();
		expect(g.find("managedCloudPostgresql/outcomes")).toBeUndefined();
	});

	it("uses PostgreSQL-16 parameterized transactional CAS and authenticated WSS epoch dedupe", async () => {
		const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
		const adapter = postgresql16ManagedCloudControlStore({
			async transaction(work) {
				return work({
					async query(sql, values) {
						queries.push({ sql, values });
						return { rows: [] };
					},
				});
			},
			async close() {},
		});
		await adapter.install();
		const envelope = {
			kind: "managed-cloud-postgresql-admitted-envelope",
			protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			runId: "run:1",
			attempt: 1,
			environmentRevision: "environment-revision:1",
			manifestFingerprint: "fingerprint:cloud:pg:1",
			requestId: "request:1",
			operationId: "operation:1",
			routeId: "route:1",
			executorId: "executor:pg",
			profileId: "profile:pg",
			adapterInputId: input().adapterInputId,
			credentialBindingRevision: "credential-binding:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			workload: input().toolCall!.arguments,
			sourceRefs: [],
		} as const;
		await adapter.admit(envelope, 10);
		await adapter.claim(
			{
				kind: "claim",
				messageId: "claim:sql:1",
				protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
				workerId: "worker:1",
				sessionEpoch: "epoch:1",
				environmentRevision: "environment-revision:1",
				deploymentRevision: "deployment:1",
				workerRevision: "worker-runtime:1",
				authAttestationRef: { kind: "attestation", id: "auth:1" },
			},
			manifest(),
			10,
		);
		expect(queries[0]?.sql).toMatch(/CREATE TABLE IF NOT EXISTS/);
		expect(queries[1]?.sql).toMatch(/ON CONFLICT DO NOTHING/);
		expect(queries[1]?.sql).toContain("$1");
		expect(queries[1]?.sql).not.toContain(envelope.runId);
		expect(queries[1]?.values[0]).toBe(envelope.runId);
		expect(queries[2]?.sql).toMatch(/FOR UPDATE SKIP LOCKED/);
		let accept: ((socket: never, text: string) => void | PromiseLike<void>) | undefined;
		let disconnect: ((socket: never) => void) | undefined;
		const sent: string[] = [];
		const transport = authenticatedWssManagedCloudTransport(
			{
				async listen(onAccept, onDisconnect) {
					accept = onAccept as never;
					disconnect = onDisconnect as never;
				},
			},
			{ verify: () => true },
		);
		const received: unknown[] = [];
		let disconnects = 0;
		await transport.start(
			(message) => received.push(message),
			() => {
				disconnects++;
			},
		);
		let capClosed = 0;
		const socket = {
			workerId: "worker:1",
			sessionEpoch: "epoch:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:1" },
			async send(text: string) {
				sent.push(text);
			},
			async close() {
				capClosed++;
			},
		};
		const claim = JSON.stringify({
			kind: "claim",
			messageId: "message:1",
			protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			environmentRevision: "environment-revision:1",
		});
		accept?.(socket as never, claim);
		accept?.(socket as never, claim);
		let conflictingClosed = 0;
		accept?.(
			{
				...socket,
				async close() {
					conflictingClosed++;
				},
			} as never,
			JSON.stringify({ ...JSON.parse(claim), messageId: "message:conflict" }),
		);
		await settle();
		expect(received).toHaveLength(1);
		expect(conflictingClosed).toBe(1);
		expect(received[0]).toMatchObject({
			workerId: "worker:1",
			sessionEpoch: "epoch:1",
			workerRevision: "worker-runtime:1",
		});
		await transport.send("worker:1", "epoch:1", {
			kind: "rejected",
			messageId: "response:1",
			code: "test",
		});
		expect(sent).toHaveLength(1);
		for (let index = 2; index <= 1024; index++)
			await accept?.(
				socket as never,
				JSON.stringify({ ...JSON.parse(claim), messageId: `message:${index}` }),
			);
		await accept?.(
			socket as never,
			JSON.stringify({ ...JSON.parse(claim), messageId: "message:1025" }),
		);
		disconnect?.(socket as never);
		disconnect?.(socket as never);
		expect(capClosed).toBe(1);
		expect(disconnects).toBe(1);
		await expect(
			transport.send("worker:1", "epoch:1", {
				kind: "rejected",
				messageId: "response:after-cap",
				code: "test",
			}),
		).rejects.toThrow("No authenticated current WSS session");
		let cappedReplacementClosed = 0;
		await accept?.(
			{
				...socket,
				async close() {
					cappedReplacementClosed++;
				},
			} as never,
			JSON.stringify({ ...JSON.parse(claim), messageId: "message:replacement-after-cap" }),
		);
		expect(cappedReplacementClosed).toBe(1);
		expect(received).toHaveLength(1024);
		await transport.close();
		let deniedAccept: ((socket: never, text: string) => void) | undefined;
		let deniedClosed = 0;
		const denied = authenticatedWssManagedCloudTransport(
			{
				async listen(onAccept) {
					deniedAccept = onAccept as never;
				},
			},
			{ verify: () => false },
		);
		const deniedMessages: unknown[] = [];
		await denied.start(
			(message) => deniedMessages.push(message),
			() => {},
		);
		deniedAccept?.(
			{
				...socket,
				async close() {
					deniedClosed++;
				},
			} as never,
			claim,
		);
		await settle();
		expect(deniedMessages).toHaveLength(0);
		expect(deniedClosed).toBe(1);
		await denied.close();

		let reconnectAccept: ((socket: never, text: string) => void | PromiseLike<void>) | undefined;
		let realDisconnect: ((socket: never) => void) | undefined;
		const reconnectTransport = authenticatedWssManagedCloudTransport(
			{
				async listen(onAccept, onDisconnect) {
					reconnectAccept = onAccept as never;
					realDisconnect = onDisconnect as never;
				},
			},
			{ verify: () => true },
		);
		const reconnectMessages: unknown[] = [];
		let realDisconnects = 0;
		await reconnectTransport.start(
			(message) => reconnectMessages.push(message),
			() => {
				realDisconnects++;
			},
		);
		await reconnectAccept?.(socket as never, claim);
		expect(reconnectMessages).toHaveLength(1);
		realDisconnect?.(socket as never);
		expect(realDisconnects).toBe(1);
		let reconnectClosed = 0;
		await reconnectAccept?.(
			{
				...socket,
				async close() {
					reconnectClosed++;
				},
			} as never,
			JSON.stringify({ ...JSON.parse(claim), messageId: "message:same-epoch-reconnect" }),
		);
		expect(reconnectClosed).toBe(1);
		expect(reconnectMessages).toHaveLength(1);
		await reconnectTransport.close();
	});

	it("rejects malicious private outcome fields before graph DATA", async () => {
		const store = new Store();
		const original = store.settle.bind(store);
		store.settle = async (message) => {
			const result = await original(message);
			return {
				...result,
				outcome: {
					...(result.outcome as object),
					endpoint: "wss://private.example",
					authToken: "secret",
				} as never,
			};
		};
		const { runtime, transport } = await activeRuntime(store);
		const outcomes = collect(runtime.outcomes);
		const issues = collect<{ code: string }>(runtime.issues);
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:malicious:settle",
			settlementId: "settlement:malicious",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:1" }],
			issueRefs: [],
			...lease,
		});
		await settle();
		expect(outcomes).toHaveLength(0);
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "managed-cloud-worker-driver-failed" }),
		);
		await runtime.dispose();
	});

	it("runs the concrete PostgreSQL adapter through runtime with two FIFO admissions and one fenced claim", async () => {
		const queued: Array<ReturnType<typeof input> extends never ? never : Record<string, unknown>> =
			[];
		let current: Record<string, unknown> | undefined;
		const sqlClient: ManagedCloudPostgresqlSqlClient = {
			async transaction(work) {
				return work({
					query: async <R extends Record<string, unknown>>(
						sql: string,
						values: readonly unknown[],
					) => {
						if (sql.startsWith("INSERT")) {
							queued.push(JSON.parse(String(values[2])));
							return { rows: [{ result: { accepted: true, code: "admitted" } } as R] };
						}
						if (sql.includes("FOR UPDATE SKIP LOCKED")) {
							const envelope = queued.shift()!;
							const claimed = {
								...lease,
								runId: envelope.runId as string,
								attempt: envelope.attempt as number,
								envelope,
								leaseExpiresAtMs: 1010,
								heartbeatExpiresAtMs: 510,
							};
							current = claimed;
							return {
								rows: [
									{
										result: {
											accepted: true,
											code: "claimed",
											lease: claimed,
											lifecycle: {
												...lifecycle("claimed"),
												runId: envelope.runId as string,
												attempt: envelope.attempt as number,
											},
										},
									} as R,
								],
							};
						}
						if (sql.includes("SET cancellation=$1::jsonb"))
							return { rows: [{ result: { accepted: true, code: "cancel-persisted" } } as R] };
						if (sql.includes("SET state='expired'")) {
							const lifecycleFact = {
								...lifecycle("expired"),
								...lease,
								runId: current!.runId,
								fencingToken: 2,
							};
							current = undefined;
							return { rows: [{ lifecycle: lifecycleFact } as R] };
						}
						if (sql.includes("SET state='lost'")) {
							const lifecycleFact = {
								...lifecycle("lost"),
								...lease,
								runId: current!.runId,
								fencingToken: 2,
							};
							current = undefined;
							return { rows: [{ lifecycle: lifecycleFact } as R] };
						}
						if (sql.includes("SET state='settled'")) {
							const envelope = current!.envelope as Record<string, unknown>;
							return {
								rows: [
									{
										result: {
											accepted: true,
											code: "settled",
											outcome: {
												kind: "result",
												outcomeId: values[1],
												requestId: envelope.requestId,
												operationId: envelope.operationId,
												routeId: envelope.routeId,
												executorId: envelope.executorId,
												profileId: envelope.profileId,
												attempt: current!.attempt,
												inputId: envelope.adapterInputId,
												inputKind: "tool-call",
												metadata: {
													runId: current!.runId,
													sessionEpoch: current!.sessionEpoch,
													fencingToken: current!.fencingToken,
												},
												result: {
													kind: "managed-cloud-result-refs",
													value: { outcomeRefs: JSON.parse(String(values[2])) },
												},
											},
										},
									} as R,
								],
							};
						}
						return { rows: [] };
					},
				});
			},
			async close() {},
		};
		const store = postgresql16ManagedCloudControlStore(sqlClient);
		const g = graph();
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedCloudPostgresqlManifest>([], null);
		const postures = g.node<ManagedCloudPostgresqlReadiness>([], null);
		const cancels = g.node([], null);
		const transport = new Transport();
		const runtime = managedCloudPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			cancellationRequests: [cancels as never],
			store,
			transport,
			now: () => 10,
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const facts = collect<ManagedCloudPostgresqlLifecycleFact>(runtime.lifecycle);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		admitted.down([["DATA", { ...run(), runId: "run:2" }]]);
		admitted.down([["DATA", { ...run(), runId: "run:3" }]]);
		await settle();
		expect(queued.map((value) => value.runId)).toEqual(["run:1", "run:2", "run:3"]);
		transport.onMessage?.({
			kind: "claim",
			messageId: "claim:concrete:1",
			protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			workerId: "worker:1",
			sessionEpoch: "epoch:worker:1",
			environmentRevision: "environment-revision:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:1" },
		});
		await settle();
		expect(transport.sent).toContainEqual(
			expect.objectContaining({ kind: "claim-granted", runId: "run:1" }),
		);
		expect(queued.map((value) => value.runId)).toEqual(["run:2", "run:3"]);
		cancels.down([
			[
				"DATA",
				{
					kind: "managed-cloud-postgresql-cancellation-requested",
					cancellationId: "cancel:concrete:1",
					...lease,
				},
			],
		]);
		await settle();
		const cancelCount = transport.sent.filter((message) => message.kind === "cancel").length;
		await runtime.expire();
		await runtime.redeliverPendingCancellations();
		expect(transport.sent.filter((message) => message.kind === "cancel")).toHaveLength(cancelCount);
		expect(facts.at(-1)).toMatchObject({ state: "expired", runId: "run:1", fencingToken: 2 });
		transport.onMessage?.({
			kind: "claim",
			messageId: "claim:concrete:2",
			protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			workerId: "worker:1",
			sessionEpoch: "epoch:worker:1",
			environmentRevision: "environment-revision:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:1" },
		});
		await settle();
		transport.onMessage?.({
			kind: "settle",
			messageId: "settle:concrete:2",
			settlementId: "settlement:concrete:2",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:concrete:2" }],
			issueRefs: [],
			...lease,
			runId: "run:2",
		});
		await settle();
		expect(outcomes.at(-1)).toMatchObject({
			kind: "result",
			evidenceRefs: [{ id: "artifact:concrete:2" }],
		});
		transport.onMessage?.({
			kind: "claim",
			messageId: "claim:concrete:3",
			protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			workerId: "worker:1",
			sessionEpoch: "epoch:worker:1",
			environmentRevision: "environment-revision:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:1" },
		});
		await settle();
		transport.onDisconnect?.("worker:1", "epoch:worker:1");
		await settle();
		expect(facts.at(-1)).toMatchObject({ state: "lost", runId: "run:3", fencingToken: 2 });
		await runtime.dispose();
	});

	it("projects strict result, failure, and canceled settlements through runtime", async () => {
		for (const [wire, expected] of [
			["succeeded", "result"],
			["failed", "failure"],
			["canceled", "canceled"],
		] as const) {
			const { runtime, transport } = await activeRuntime();
			const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
			transport.onMessage?.({
				kind: "settle",
				messageId: `message:${wire}`,
				settlementId: `settlement:${wire}`,
				outcome: wire,
				outcomeRefs: [{ kind: "artifact", id: `artifact:${wire}` }],
				issueRefs: [{ kind: "artifact", id: `issue:${wire}` }],
				...lease,
			});
			await settle();
			expect(outcomes.at(-1)?.kind).toBe(expected);
			expect(outcomes.at(-1)).toMatchObject({
				evidenceRefs: [{ id: `artifact:${wire}` }],
				metadata: { issueRefs: [{ id: `issue:${wire}` }] },
			});
			if (expected === "failure")
				expect(outcomes.at(-1)).toMatchObject({ error: { sourceRefs: [{ id: `issue:${wire}` }] } });
			expect(JSON.stringify(outcomes)).not.toMatch(/endpoint|authToken|signedUrl/);
			await runtime.dispose();
		}
	});
});

async function activeRuntime(store = new Store()) {
	const g = graph();
	const inputs = g.node([], null);
	const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
	const manifests = g.node<ManagedCloudPostgresqlManifest>([], null);
	const postures = g.node<ManagedCloudPostgresqlReadiness>([], null);
	const transport = new Transport();
	const runtime = managedCloudPostgresqlRuntime(g, {
		inputs: inputs as never,
		admittedRunRequests: [admitted],
		manifests: [manifests],
		readiness: [postures],
		store,
		transport,
		now: () => 10,
	});
	inputs.down([["DATA", input()]]);
	manifests.down([["DATA", manifest()]]);
	postures.down([["DATA", readiness()]]);
	admitted.down([["DATA", run()]]);
	await settle();
	transport.onMessage?.({
		kind: "claim",
		messageId: "message:claim:1",
		protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
		workerId: "worker:1",
		sessionEpoch: "epoch:worker:1",
		environmentRevision: "environment-revision:1",
		deploymentRevision: "deployment:1",
		workerRevision: "worker-runtime:1",
		authAttestationRef: { kind: "attestation", id: "auth:1" },
	});
	await settle();
	return { runtime, transport, store, g };
}
