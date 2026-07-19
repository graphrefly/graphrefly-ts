import { describe, expect, it } from "vitest";
import {
	authenticatedWssManagedCloudTransport,
	executeManagedCloudPostgresqlClaimWithAttemptCredential,
	executeManagedCloudPostgresqlClaimWithAuthorizedAttemptCredential,
	MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
	MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE,
	MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE,
	MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
	MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION,
	type ManagedCloudPostgresqlAttemptCredentialDriver,
	type ManagedCloudPostgresqlAuthorizationRecheckDriver,
	type ManagedCloudPostgresqlAuthorizationRecheckResult,
	type ManagedCloudPostgresqlControlMessage,
	type ManagedCloudPostgresqlControlStoreDriver,
	type ManagedCloudPostgresqlCredentialLifecycleFact,
	type ManagedCloudPostgresqlLeaseCoordinates,
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
import { compoundTupleKey } from "../identity.js";
import type { ExecutorOutcome, ToolProviderAdapterRunRequested } from "../orchestration/index.js";

const manifest = (
	patch: Partial<ManagedCloudPostgresqlManifest> = {},
): ManagedCloudPostgresqlManifest =>
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
		deploymentProfile: MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE,
		workerRevision: "worker-runtime:1",
		leaseDurationMs: 1000,
		heartbeatDurationMs: 500,
		attestationRefs: [{ kind: "attestation", id: "attestation:cloud:1" }],
		...patch,
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
		deploymentProfile: MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE,
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
const canonicalAdmissionProposalId = compoundTupleKey("tool-provider-run-admission-proposal", [
	"candidate:run:1",
]);
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
	sourceRefs: [
		{ kind: "tool-provider-run-admission-proposal", id: canonicalAdmissionProposalId },
		{ kind: "tool-provider-run-admission", id: "admission:1" },
		{ kind: "tool-provider-run-admission-decision", id: "admission-decision:1" },
	],
	metadata: {
		principalId: "principal:1",
		principalSessionRevision: "principal-session:1",
		tenantId: "tenant:1",
		workspaceId: "workspace:1",
		resourceKind: "managed-postgresql-connection",
		resourceId: "connection:1",
		resourceRevision: "connection-revision:1",
		policyRevision: "policy:1",
		modelRevision: "model:1",
		admissionId: "admission:1",
		proposalId: canonicalAdmissionProposalId,
		decisionId: "admission-decision:1",
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
const exactAuthorityCoordinates = {
	principalId: "principal:1",
	principalSessionRevision: "principal-session:1",
	tenantId: "tenant:1",
	workspaceId: "workspace:1",
	resourceKind: "managed-postgresql-connection",
	resourceId: "connection:1",
	resourceRevision: "connection-revision:1",
	policyRevision: "policy:1",
	modelRevision: "model:1",
} as const;
const admissionEnvelope = {
	...exactAuthorityCoordinates,
	admissionId: "admission:1",
	admissionProposalId: canonicalAdmissionProposalId,
	admissionDecisionId: "admission-decision:1",
} as const;
const admissionSourceRefs = [
	{ kind: "tool-provider-run-admission-proposal", id: canonicalAdmissionProposalId },
	{ kind: "tool-provider-run-admission", id: "admission:1" },
	{ kind: "tool-provider-run-admission-decision", id: "admission-decision:1" },
] as const;
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
const credentialFact = (
	state: ManagedCloudPostgresqlCredentialLifecycleFact["state"],
	patch: Partial<ManagedCloudPostgresqlCredentialLifecycleFact> = {},
): ManagedCloudPostgresqlCredentialLifecycleFact => ({
	kind: "managed-cloud-postgresql-credential-lifecycle-fact",
	state,
	...lease,
	credentialBindingRevision: "credential-binding:1",
	occurredAtMs: 20,
	...(["issued", "injected", "revoking"].includes(state) ? { expiresAtMs: 1010 } : {}),
	evidenceRefs: [{ kind: "evidence", id: `managed-cloud-attempt-${state}` }],
	issueRefs: [],
	...patch,
});
const credentialLifecycleSequence = () => [
	credentialFact("issue-requested"),
	credentialFact("issued"),
	credentialFact("injected"),
	credentialFact("revoking"),
	credentialFact("revoked"),
];
const readyCredentialDriver = (
	onPrepare?: (
		context: Parameters<
			ManagedCloudPostgresqlAttemptCredentialDriver["prepareAttemptCredential"]
		>[0],
	) => void,
	onCleanup?: () => void,
): ManagedCloudPostgresqlAttemptCredentialDriver => ({
	compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
	async prepareAttemptCredential(context) {
		onPrepare?.(context);
		return { ready: true, lifecycle: credentialLifecycleSequence().slice(0, 3) };
	},
	async cleanupAttemptCredential() {
		onCleanup?.();
		return { lifecycle: credentialLifecycleSequence() };
	},
});
const authorizationRecheck = (
	stage: ManagedCloudPostgresqlAuthorizationRecheckResult["stage"],
	patch: Partial<ManagedCloudPostgresqlAuthorizationRecheckResult> = {},
): ManagedCloudPostgresqlAuthorizationRecheckResult => ({
	kind: "managed-cloud-postgresql-authorization-recheck-result",
	stage,
	state: "allowed",
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
	requestId: "request:1",
	operationId: "operation:1",
	routeId: "route:1",
	executorId: "executor:pg",
	profileId: "profile:pg",
	adapterInputId: input().adapterInputId,
	...admissionEnvelope,
	decisionRef: `authorization-decision:${stage}:1`,
	authorizationRevisionRef: "authorization-revision:31",
	authorizationExpiresAtMs: 10_100,
	grantGeneration: 11,
	grantHighWater: 31,
	observedAtMs: 10,
	issueRefs: [],
	auditRefs: [{ kind: "audit", id: `authorization-audit:${stage}:1` }],
	...(stage === "credential-issuance" ? { credentialBindingRevision: "credential-binding:1" } : {}),
	...patch,
});
const allowAuthorizationRecheckDriver = (): ManagedCloudPostgresqlAuthorizationRecheckDriver => ({
	compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
	async authorizeClaim(request) {
		return authorizationRecheck("claim", leaseCoordinatesPatch(request.lease));
	},
	async authorizeCredentialIssuance(context) {
		return authorizationRecheck("credential-issuance", {
			...leaseCoordinatesPatch(context),
			credentialBindingRevision: context.credentialBindingRevision,
		});
	},
});
const leaseCoordinatesPatch = (
	value: ManagedCloudPostgresqlLeaseCoordinates,
): Pick<
	ManagedCloudPostgresqlAuthorizationRecheckResult,
	| "runId"
	| "attempt"
	| "environmentRevision"
	| "manifestFingerprint"
	| "leaseId"
	| "fencingToken"
	| "workerId"
	| "sessionEpoch"
	| "deploymentRevision"
	| "workerRevision"
> => ({
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
	async rejectClaim(lease: NonNullable<ManagedCloudPostgresqlStoreResult["lease"]>, code: string) {
		this.calls.push(`reject-claim:${code}`);
		const {
			envelope: _envelope,
			heartbeatExpiresAtMs: _heartbeat,
			leaseExpiresAtMs: _lease,
			...coordinates
		} = lease;
		return {
			accepted: true,
			code,
			lifecycle: { ...lifecycle("rejected"), ...coordinates, code },
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
		expect(() =>
			managedCloudPostgresqlManifest({
				...manifest(),
				deploymentProfile: "laptop-compose-prod",
			} as never),
		).toThrow(/deployment profile/);
		expect(() => managedCloudPostgresqlReadiness({ ...readiness(), expiresAtMs: 0 })).toThrow();
		expect(() =>
			managedCloudPostgresqlReadiness({
				...readiness(),
				deploymentProfile: "docker-compose-development",
			}),
		).toThrow(/readiness/);
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
			authorizationRecheck: allowAuthorizationRecheckDriver(),
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
				admissionId: "admission:1",
				admissionProposalId: canonicalAdmissionProposalId,
				admissionDecisionId: "admission-decision:1",
				credentialBindingRevision: "credential-binding:1",
				deploymentRevision: "deployment:1",
				workerRevision: "worker-runtime:1",
			}),
		]);
		admitted.down([
			[
				"DATA",
				{
					...run(),
					runId: "run:forged-admission",
					metadata: { ...run().metadata, admissionId: "admission:forged" },
				},
			],
		]);
		await settle();
		expect(envelopes).toHaveLength(1);
		expect(store.calls).toEqual(["admit"]);
		expect(admissionIssues).toContainEqual(
			expect.objectContaining({ code: "managed-cloud-admission-driver-failed" }),
		);
		const malformedProposalId =
			'tool-provider-run-admission-proposal:["candidate:run:1",{"private":"value"}]';
		admitted.down([
			[
				"DATA",
				{
					...run(),
					runId: "run:malformed-proposal",
					sourceRefs: [
						{ kind: "tool-provider-run-admission-proposal", id: malformedProposalId },
						{ kind: "tool-provider-run-admission", id: "admission:1" },
						{ kind: "tool-provider-run-admission-decision", id: "admission-decision:1" },
					],
					metadata: { ...run().metadata, proposalId: malformedProposalId },
				},
			],
		]);
		await settle();
		expect(envelopes).toHaveLength(1);
		expect(store.calls).toEqual(["admit"]);
		const noncanonicalProposalId = 'tool-provider-run-admission-proposal:[ "candidate:run:1" ]';
		admitted.down([
			[
				"DATA",
				{
					...run(),
					runId: "run:noncanonical-proposal",
					sourceRefs: [
						{ kind: "tool-provider-run-admission-proposal", id: noncanonicalProposalId },
						{ kind: "tool-provider-run-admission", id: "admission:1" },
						{ kind: "tool-provider-run-admission-decision", id: "admission-decision:1" },
					],
					metadata: { ...run().metadata, proposalId: noncanonicalProposalId },
				},
			],
		]);
		await settle();
		expect(envelopes).toHaveLength(1);
		expect(store.calls).toEqual(["admit"]);
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

	it("rechecks current authorization after claim CAS and before dispatch", async () => {
		const g = graph();
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedCloudPostgresqlManifest>([], null);
		const postures = g.node<ManagedCloudPostgresqlReadiness>([], null);
		const store = new Store();
		const transport = new Transport();
		let claimRequests = 0;
		const authorizationRecheckDriver: ManagedCloudPostgresqlAuthorizationRecheckDriver = {
			compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
			async authorizeClaim(request) {
				claimRequests += 1;
				expect(request.lease.envelope.runId).toBe("run:1");
				return authorizationRecheck("claim", {
					state: "revoked",
					authorizationRevisionRef: undefined,
					authorizationExpiresAtMs: undefined,
					issueRefs: [{ kind: "issue", id: "authorization-revoked" }],
				});
			},
			async authorizeCredentialIssuance() {
				throw new Error("credential issuance is not reached by claim recheck");
			},
		};
		const runtime = managedCloudPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			store,
			transport,
			authorizationRecheck: authorizationRecheckDriver,
			now: () => 10,
		});
		const facts = collect<ManagedCloudPostgresqlLifecycleFact>(runtime.lifecycle);
		const issues = collect<{ code: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		transport.onMessage?.({
			kind: "claim",
			messageId: "message:claim:recheck",
			protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			workerId: "worker:1",
			sessionEpoch: "epoch:worker:1",
			environmentRevision: "environment-revision:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:1" },
		});
		await settle();
		for (let i = 0; i < 5 && transport.sent.length === 0; i++) await settle();
		expect(claimRequests).toBe(1);
		expect(store.calls).toEqual(["admit", "claim", "reject-claim:authorization-revoked"]);
		expect(transport.sent).toContainEqual(
			expect.objectContaining({ kind: "rejected", code: "authorization-revoked" }),
		);
		expect(transport.sent).not.toContainEqual(expect.objectContaining({ kind: "claim-granted" }));
		expect(facts.map((fact) => fact.state)).toEqual(["queued", "rejected"]);
		expect(issues).toContainEqual(expect.objectContaining({ code: "authorization-revoked" }));
		await runtime.dispose();
	});

	it("rejects a claimed lease when claim authorization recheck is unavailable", async () => {
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
			authorizationRecheck: {
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async authorizeClaim() {
					throw new Error("authorization provider unavailable");
				},
				async authorizeCredentialIssuance() {
					throw new Error("credential issuance is not reached by unavailable claim recheck");
				},
			},
			now: () => 10,
		});
		const issues = collect<{ code: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		transport.onMessage?.({
			kind: "claim",
			messageId: "message:claim:recheck-unavailable",
			protocolRevision: MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			workerId: "worker:1",
			sessionEpoch: "epoch:worker:1",
			environmentRevision: "environment-revision:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:1" },
		});
		await settle();
		for (let i = 0; i < 5 && transport.sent.length === 0; i++) await settle();
		expect(store.calls).toEqual(["admit", "claim", "reject-claim:authorization-unavailable"]);
		expect(transport.sent).toContainEqual(
			expect.objectContaining({ kind: "rejected", code: "authorization-unavailable" }),
		);
		expect(transport.sent).not.toContainEqual(expect.objectContaining({ kind: "claim-granted" }));
		expect(issues).toContainEqual(expect.objectContaining({ code: "authorization-unavailable" }));
		await runtime.dispose();
	});

	it("fails closed before admission when the deployment profile is development-only", async () => {
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
			authorizationRecheck: allowAuthorizationRecheckDriver(),
			now: () => 10,
		});
		const envelopes = collect(runtime.admittedEnvelopes);
		const issues = collect<{ code: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest({ deploymentProfile: "docker-compose-development" })]]);
		postures.down([
			[
				"DATA",
				readiness({
					state: "unavailable",
					deploymentProfile: "docker-compose-development",
				}),
			],
		]);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(envelopes).toHaveLength(0);
		expect(store.calls).toHaveLength(0);
		expect(transport.sent).toHaveLength(0);
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "managed-cloud-admission-not-ready" }),
		);
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

	it("accepts only a legal current credential lifecycle prefix for the active claim", async () => {
		const { runtime, transport } = await activeRuntime();
		const facts = collect<ManagedCloudPostgresqlCredentialLifecycleFact>(
			runtime.credentialLifecycle,
		);
		const issues = collect<{ code: string }>(runtime.issues);
		for (const [index, state] of ["issue-requested", "issued", "injected"].entries()) {
			transport.onMessage?.({
				kind: "credential-lifecycle",
				messageId: `message:credential:${state}`,
				...lease,
				credentialBindingRevision: "credential-binding:1",
				state,
				occurredAtMs: 20 + index,
				...(["issued", "injected"].includes(state) ? { expiresAtMs: 1010 } : {}),
				evidenceRefs: [{ kind: "evidence", id: `managed-cloud-attempt-${state}` }],
				issueRefs: [],
			});
			await settle();
		}
		expect(facts).toMatchObject([
			{ state: "issue-requested" },
			{ state: "issued" },
			{ state: "injected", credentialBindingRevision: "credential-binding:1" },
		]);
		expect(transport.sent).toContainEqual(
			expect.objectContaining({ kind: "accepted", operation: "credential-lifecycle" }),
		);
		transport.onMessage?.({
			kind: "credential-lifecycle",
			messageId: "message:credential:wrong-binding",
			...lease,
			credentialBindingRevision: "credential-binding:other",
			state: "issued",
			occurredAtMs: 21,
			expiresAtMs: 1010,
			evidenceRefs: [],
			issueRefs: [],
		});
		await settle();
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "credential-lifecycle-transition-invalid" }),
		);
		transport.onMessage?.({
			kind: "credential-lifecycle",
			messageId: "message:credential:missing-expiry",
			...lease,
			credentialBindingRevision: "credential-binding:1",
			state: "issued",
			occurredAtMs: 21,
			evidenceRefs: [],
			issueRefs: [],
		});
		await settle();
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "managed-cloud-envelope-invalid" }),
		);
		transport.onMessage?.({
			kind: "credential-lifecycle",
			messageId: "message:credential:duplicate-injected",
			...lease,
			credentialBindingRevision: "credential-binding:1",
			state: "injected",
			occurredAtMs: 23,
			expiresAtMs: 1010,
			evidenceRefs: [{ kind: "evidence", id: "managed-cloud-attempt-injected" }],
			issueRefs: [],
		});
		await settle();
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "credential-lifecycle-transition-invalid" }),
		);
		transport.onMessage?.({
			kind: "credential-lifecycle",
			messageId: "message:credential:private-ref",
			...lease,
			credentialBindingRevision: "credential-binding:1",
			state: "issued",
			occurredAtMs: 22,
			expiresAtMs: 900,
			evidenceRefs: [{ kind: "evidence", id: "openbao-vault-path" }],
			issueRefs: [],
		});
		await settle();
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "managed-cloud-envelope-invalid" }),
		);
		expect(JSON.stringify({ facts, issues })).not.toMatch(
			/openbao-vault-path|spiffe:\/\/|jwt-svid|private-token|private-secret/i,
		);
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:streamed-prefix",
			settlementId: "settlement:streamed-prefix",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:streamed-prefix" }],
			issueRefs: [],
			credentialLifecycle: [
				credentialFact("issue-requested", { occurredAtMs: 20 }),
				credentialFact("issued", { occurredAtMs: 21 }),
				credentialFact("injected", { occurredAtMs: 22 }),
				credentialFact("revoking", { occurredAtMs: 23 }),
				credentialFact("revoked", { occurredAtMs: 24 }),
			],
			...lease,
		});
		await settle();
		expect(facts.map((fact) => fact.state)).toEqual([
			"issue-requested",
			"issued",
			"injected",
			"revoking",
			"revoked",
		]);
		await runtime.dispose();
	});

	it("emits settlement credential lifecycle evidence only after terminal cleanup posture", async () => {
		const { runtime, transport } = await activeRuntime();
		const facts = collect<ManagedCloudPostgresqlCredentialLifecycleFact>(
			runtime.credentialLifecycle,
		);
		const outcomes = collect(runtime.outcomes);
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:credential",
			settlementId: "settlement:credential",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:credential-result" }],
			issueRefs: [],
			credentialLifecycle: credentialLifecycleSequence(),
			...lease,
		});
		await settle();
		expect(facts.map((fact) => fact.state)).toEqual([
			"issue-requested",
			"issued",
			"injected",
			"revoking",
			"revoked",
		]);
		expect(outcomes).toHaveLength(1);
		const missingTerminal = await activeRuntime();
		const terminalIssues = collect<{ code: string }>(missingTerminal.runtime.issues);
		missingTerminal.transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:no-cleanup",
			settlementId: "settlement:no-cleanup",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:no-cleanup" }],
			issueRefs: [],
			credentialLifecycle: [credentialFact("injected")],
			...lease,
		});
		await settle();
		expect(terminalIssues).toContainEqual(
			expect.objectContaining({ code: "credential-cleanup-not-terminal" }),
		);
		await runtime.dispose();
		await missingTerminal.runtime.dispose();
	});

	it("fences standalone credential transitions while settlement is committing", async () => {
		let enterSettlement!: () => void;
		let releaseSettlement!: () => void;
		const settlementEntered = new Promise<void>((resolve) => {
			enterSettlement = resolve;
		});
		const settlementRelease = new Promise<void>((resolve) => {
			releaseSettlement = resolve;
		});
		class DelayedSettlementStore extends Store {
			override async settle(
				input: Parameters<ManagedCloudPostgresqlControlStoreDriver["settle"]>[0],
			): Promise<ManagedCloudPostgresqlStoreResult> {
				enterSettlement();
				await settlementRelease;
				return super.settle(input);
			}
		}
		const { runtime, transport } = await activeRuntime(new DelayedSettlementStore());
		const facts = collect<ManagedCloudPostgresqlCredentialLifecycleFact>(
			runtime.credentialLifecycle,
		);
		const outcomes = collect(runtime.outcomes);
		const issues = collect<{ code: string }>(runtime.issues);
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:delayed",
			settlementId: "settlement:delayed",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:delayed" }],
			issueRefs: [],
			credentialLifecycle: credentialLifecycleSequence(),
			...lease,
		});
		await settlementEntered;
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:concurrent",
			settlementId: "settlement:concurrent",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:concurrent" }],
			issueRefs: [],
			credentialLifecycle: credentialLifecycleSequence(),
			...lease,
		});
		await settle();
		expect(transport.sent).toContainEqual(
			expect.objectContaining({
				kind: "rejected",
				messageId: "message:settle:concurrent",
				code: "settlement-in-progress",
			}),
		);
		transport.onMessage?.({
			kind: "credential-lifecycle",
			messageId: "message:credential:during-settlement",
			...lease,
			credentialBindingRevision: "credential-binding:1",
			state: "issue-requested",
			occurredAtMs: 20,
			evidenceRefs: [{ kind: "evidence", id: "managed-cloud-attempt-issue-requested" }],
			issueRefs: [],
		});
		await settle();
		expect(transport.sent).toContainEqual(
			expect.objectContaining({
				kind: "rejected",
				messageId: "message:credential:during-settlement",
				code: "credential-lifecycle-settling",
			}),
		);
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "credential-lifecycle-settling" }),
		);
		releaseSettlement();
		await settle();
		expect(facts.map((fact) => fact.state)).toEqual([
			"issue-requested",
			"issued",
			"injected",
			"revoking",
			"revoked",
		]);
		expect(outcomes).toHaveLength(1);
		expect(transport.sent).toContainEqual(
			expect.objectContaining({
				kind: "accepted",
				messageId: "message:settle:delayed",
				operation: "settle",
			}),
		);
		await runtime.dispose();
	});

	it("keeps a committed settlement fenced when store projection evidence is malformed", async () => {
		class MalformedSettlementStore extends Store {
			override async settle(): Promise<ManagedCloudPostgresqlStoreResult> {
				this.calls.push("settle:malformed");
				return { accepted: true, code: "settled", lifecycle: lifecycle("settled") };
			}
		}
		const { runtime, transport } = await activeRuntime(new MalformedSettlementStore());
		const issues = collect<{ code: string }>(runtime.issues);
		const outcomes = collect(runtime.outcomes);
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:malformed-store-result",
			settlementId: "settlement:malformed-store-result",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:malformed" }],
			issueRefs: [],
			credentialLifecycle: credentialLifecycleSequence(),
			...lease,
		});
		await settle();
		expect(outcomes).toHaveLength(0);
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "managed-cloud-settlement-reconciliation-required" }),
		);
		transport.onMessage?.({
			kind: "credential-lifecycle",
			messageId: "message:credential:after-malformed-settlement",
			...lease,
			credentialBindingRevision: "credential-binding:1",
			state: "issue-requested",
			occurredAtMs: 20,
			evidenceRefs: [{ kind: "evidence", id: "managed-cloud-attempt-issue-requested" }],
			issueRefs: [],
		});
		await settle();
		expect(transport.sent).toContainEqual(
			expect.objectContaining({
				kind: "rejected",
				messageId: "message:credential:after-malformed-settlement",
				code: "credential-lifecycle-settling",
			}),
		);
		await runtime.dispose();
	});

	it("keeps settlement fenced when commit evidence is lost after store dispatch", async () => {
		class CommitResponseLostStore extends Store {
			override async settle(
				input: Parameters<ManagedCloudPostgresqlControlStoreDriver["settle"]>[0],
			): Promise<ManagedCloudPostgresqlStoreResult> {
				await super.settle(input);
				throw new Error("commit response lost");
			}
		}
		const { runtime, transport } = await activeRuntime(new CommitResponseLostStore());
		const issues = collect<{ code: string }>(runtime.issues);
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:response-lost",
			settlementId: "settlement:response-lost",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:response-lost" }],
			issueRefs: [],
			credentialLifecycle: credentialLifecycleSequence(),
			...lease,
		});
		await settle();
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "managed-cloud-settlement-reconciliation-required" }),
		);
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:retry-after-response-lost",
			settlementId: "settlement:retry-after-response-lost",
			outcome: "succeeded",
			outcomeRefs: [],
			issueRefs: [],
			credentialLifecycle: credentialLifecycleSequence(),
			...lease,
		});
		await settle();
		expect(transport.sent).toContainEqual(
			expect.objectContaining({
				kind: "rejected",
				messageId: "message:settle:retry-after-response-lost",
				code: "settlement-in-progress",
			}),
		);
		await runtime.dispose();
	});

	it("rejects bare settlements before store mutation and graph credential facts", async () => {
		const { runtime, transport, store } = await activeRuntime();
		const facts = collect<ManagedCloudPostgresqlCredentialLifecycleFact>(
			runtime.credentialLifecycle,
		);
		const outcomes = collect(runtime.outcomes);
		const issues = collect<{ code: string }>(runtime.issues);
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:bare",
			settlementId: "settlement:bare",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:bare" }],
			issueRefs: [],
			...lease,
		});
		await settle();
		expect(store.calls).not.toContain("settle:settlement:bare");
		expect(facts).toHaveLength(0);
		expect(outcomes).toHaveLength(0);
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "credential-lifecycle-required" }),
		);
		expect(transport.sent).toContainEqual(
			expect.objectContaining({ kind: "rejected", code: "credential-lifecycle-required" }),
		);
		await runtime.dispose();
	});

	it("does not publish credential lifecycle facts when settlement CAS rejects", async () => {
		const store = new Store();
		store.settle = async (message) => {
			store.calls.push(`settle:${message.settlementId}`);
			return { accepted: false, code: "stale-or-duplicate-settlement" };
		};
		const { runtime, transport } = await activeRuntime(store);
		const facts = collect<ManagedCloudPostgresqlCredentialLifecycleFact>(
			runtime.credentialLifecycle,
		);
		const outcomes = collect(runtime.outcomes);
		const issues = collect<{ code: string }>(runtime.issues);
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:stale",
			settlementId: "settlement:stale",
			outcome: "succeeded",
			outcomeRefs: [{ kind: "artifact", id: "artifact:stale" }],
			issueRefs: [],
			credentialLifecycle: credentialLifecycleSequence(),
			...lease,
		});
		await settle();
		expect(facts).toHaveLength(0);
		expect(outcomes).toHaveLength(0);
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "stale-or-duplicate-settlement" }),
		);
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
			authorizationRecheck: allowAuthorizationRecheckDriver(),
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
			credentialLifecycle: credentialLifecycleSequence(),
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

	it("derives canceled settlement only from the private worker driver over the claimed immutable workload", async () => {
		const store = new Store();
		await store.admit(
			{
				...(store.envelope ?? {}),
				kind: "managed-cloud-postgresql-admitted-envelope",
				...admissionEnvelope,
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
				sourceRefs: admissionSourceRefs,
			},
			10,
		);
		const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
		const settlement = await executeManagedCloudPostgresqlClaimWithAuthorizedAttemptCredential(
			{ kind: "claim-granted", messageId: "claim:1", ...claim.lease! },
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute(workload, context) {
					expect(workload.schemaRef).toBe("schema:1");
					expect(context.credentialBindingRevision).toBe("credential-binding:1");
					return { outcome: "canceled", outcomeRefs: [] };
				},
			},
			"settlement:worker:1",
			"message:worker:settle:1",
			new AbortController().signal,
			() => 10,
			readyCredentialDriver(),
			allowAuthorizationRecheckDriver(),
		);
		expect(settlement).toMatchObject({
			kind: "settle",
			outcome: "canceled",
			fencingToken: 1,
			outcomeRefs: [],
		});
	});

	it("runs attempt credentials through a host-private lifecycle seam before settlement", async () => {
		const store = new Store();
		await store.admit(
			{
				...(store.envelope ?? {}),
				kind: "managed-cloud-postgresql-admitted-envelope",
				...admissionEnvelope,
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
				sourceRefs: admissionSourceRefs,
			},
			10,
		);
		const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
		const calls: string[] = [];
		const credentialDriver: ManagedCloudPostgresqlAttemptCredentialDriver = {
			compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
			async prepareAttemptCredential(context) {
				expect(context.credentialBindingRevision).toBe("credential-binding:1");
				expect(context.leaseExpiresAtMs).toBe(1010);
				expect(context.envelope).toMatchObject({
					requestId: "request:1",
					routeId: "route:1",
					admissionId: "admission:1",
				});
				expect(context.authorization).toMatchObject({
					state: "allowed",
					authorizationRevisionRef: "authorization-revision:31",
				});
				calls.push("issue");
				calls.push("inject");
				return {
					ready: true,
					lifecycle: credentialLifecycleSequence().slice(0, 3),
				};
			},
			async cleanupAttemptCredential() {
				calls.push("revoke");
				return { lifecycle: credentialLifecycleSequence() };
			},
		};
		const settlement = await executeManagedCloudPostgresqlClaimWithAuthorizedAttemptCredential(
			{ kind: "claim-granted", messageId: "claim:1", ...claim.lease! },
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute(_workload, context) {
					calls.push(`execute:${context.credentialBindingRevision}`);
					return { outcome: "succeeded", outcomeRefs: [{ kind: "artifact", id: "artifact:1" }] };
				},
			},
			"settlement:worker:1",
			"message:worker:settle:1",
			new AbortController().signal,
			() => 10,
			credentialDriver,
			allowAuthorizationRecheckDriver(),
		);
		expect(calls).toEqual(["issue", "inject", "execute:credential-binding:1", "revoke"]);
		expect(settlement).toMatchObject({
			outcome: "succeeded",
			credentialLifecycle: [
				{ state: "issue-requested" },
				{ state: "issued" },
				{ state: "injected" },
				{ state: "revoking" },
				{ state: "revoked" },
			],
		});
		expect(JSON.stringify(settlement)).not.toMatch(
			/postgresql:\/\/|private-password|jwt-svid|spiffe:\/\/|openbao-vault-path|private-token|private-key|private-client|private-socket/i,
		);
	});

	it("rechecks authorization before issuing attempt credentials", async () => {
		const store = new Store();
		await store.admit(
			{
				...(store.envelope ?? {}),
				kind: "managed-cloud-postgresql-admitted-envelope",
				...admissionEnvelope,
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
				sourceRefs: admissionSourceRefs,
			},
			10,
		);
		const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
		const calls: string[] = [];
		const credentialDriver: ManagedCloudPostgresqlAttemptCredentialDriver = {
			compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
			async prepareAttemptCredential() {
				calls.push("credential-driver");
				return {
					ready: false,
					lifecycle: [credentialFact("issue-requested"), credentialFact("unavailable")],
				};
			},
			async cleanupAttemptCredential() {
				throw new Error("cleanup must not run");
			},
		};
		const authorizationDriver: ManagedCloudPostgresqlAuthorizationRecheckDriver = {
			compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
			async authorizeClaim() {
				throw new Error("claim recheck is not used by worker helper");
			},
			async authorizeCredentialIssuance(context) {
				expect(context.credentialBindingRevision).toBe("credential-binding:1");
				return authorizationRecheck("credential-issuance", {
					state: "expired",
					authorizationRevisionRef: undefined,
					authorizationExpiresAtMs: undefined,
					grantGeneration: 0,
					grantHighWater: 0,
					issueRefs: [{ kind: "issue", id: "authorization-expired" }],
					observedAtMs: 22,
				});
			},
		};
		const settlement = await executeManagedCloudPostgresqlClaimWithAuthorizedAttemptCredential(
			{ kind: "claim-granted", messageId: "claim:1", ...claim.lease! },
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					calls.push("execute");
					return { outcome: "succeeded", outcomeRefs: [] };
				},
			},
			"settlement:worker:authorization-expired",
			"message:worker:settle:authorization-expired",
			new AbortController().signal,
			() => 22,
			credentialDriver,
			authorizationDriver,
		);
		expect(calls).toEqual([]);
		expect(settlement).toMatchObject({
			outcome: "failed",
			issueRefs: [{ kind: "issue", id: "authorization-expired" }],
			credentialLifecycle: [
				{ state: "issue-requested", occurredAtMs: 22 },
				{ state: "unavailable", occurredAtMs: 22 },
			],
		});
		expect(JSON.stringify(settlement)).not.toMatch(
			/openbao|spiffe|svid|vault|private-key|private-client|private-socket|bearer|refresh/i,
		);
	});

	it("returns a failed settlement when credential authorization recheck throws or mismatches", async () => {
		for (const [name, authorizeCredentialIssuance] of [
			[
				"throws",
				async () => {
					throw new Error("authorization provider unavailable");
				},
			],
			[
				"mismatches",
				async () =>
					authorizationRecheck("credential-issuance", {
						leaseId: "lease:other",
						credentialBindingRevision: "credential-binding:1",
					}),
			],
			[
				"private-proposal-coordinate",
				async () =>
					authorizationRecheck("credential-issuance", {
						admissionProposalId: compoundTupleKey("tool-provider-run-admission-proposal", [
							"private-token",
						]),
						credentialBindingRevision: "credential-binding:1",
					}),
			],
		] satisfies readonly [
			string,
			ManagedCloudPostgresqlAuthorizationRecheckDriver["authorizeCredentialIssuance"],
		][]) {
			const store = new Store();
			await store.admit(
				{
					...(store.envelope ?? {}),
					kind: "managed-cloud-postgresql-admitted-envelope",
					...admissionEnvelope,
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
					sourceRefs: admissionSourceRefs,
				},
				10,
			);
			const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
			const calls: string[] = [];
			const settlement = await executeManagedCloudPostgresqlClaimWithAuthorizedAttemptCredential(
				{ kind: "claim-granted", messageId: `claim:${name}`, ...claim.lease! },
				{
					compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
					async execute() {
						calls.push("execute");
						return { outcome: "succeeded", outcomeRefs: [] };
					},
				},
				`settlement:worker:${name}`,
				`message:worker:settle:${name}`,
				new AbortController().signal,
				() => 10,
				readyCredentialDriver(() => calls.push("credential-driver")),
				{
					compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
					async authorizeClaim() {
						throw new Error("claim recheck is not used by worker helper");
					},
					authorizeCredentialIssuance,
				},
			);
			expect(calls).toEqual([]);
			expect(settlement).toMatchObject({
				outcome: "failed",
				issueRefs: [{ kind: "issue", id: "authorization-unavailable" }],
				credentialLifecycle: [{ state: "issue-requested" }, { state: "unavailable" }],
			});
		}
	});

	it("projects helper-produced authorization failure through the runtime", async () => {
		const { runtime, transport, store } = await activeRuntime();
		const facts = collect<ManagedCloudPostgresqlCredentialLifecycleFact>(
			runtime.credentialLifecycle,
		);
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const settlement = await executeManagedCloudPostgresqlClaimWithAttemptCredential(
			{
				kind: "claim-granted",
				messageId: "message:claim:authorization-unavailable",
				...lease,
				envelope: store.envelope!,
				leaseExpiresAtMs: 1010,
				heartbeatExpiresAtMs: 510,
			},
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					throw new Error("workload must not execute");
				},
			},
			"settlement:authorization-unavailable",
			"message:settle:authorization-unavailable",
			new AbortController().signal,
			() => 10,
			readyCredentialDriver(),
			{
				...allowAuthorizationRecheckDriver(),
				async authorizeCredentialIssuance() {
					throw new Error("authorization provider unavailable");
				},
			},
		);
		transport.onMessage?.(settlement);
		await settle();
		expect(facts.map((fact) => fact.state)).toEqual(["issue-requested", "unavailable"]);
		expect(outcomes.at(-1)).toMatchObject({
			kind: "failure",
			error: { sourceRefs: [{ id: "authorization-unavailable" }] },
		});
		expect(transport.sent).toContainEqual(
			expect.objectContaining({
				kind: "accepted",
				messageId: "message:settle:authorization-unavailable",
				operation: "settle",
			}),
		);
		await runtime.dispose();
	});

	it("requires an attempt credential lifecycle driver on the canonical worker entry", async () => {
		const store = new Store();
		await store.admit(
			{
				...(store.envelope ?? {}),
				kind: "managed-cloud-postgresql-admitted-envelope",
				...admissionEnvelope,
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
				sourceRefs: admissionSourceRefs,
			},
			10,
		);
		const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
		let executed = false;
		const worker = {
			compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
			async execute() {
				executed = true;
				return { outcome: "succeeded" as const, outcomeRefs: [] };
			},
		};
		await expect(
			executeManagedCloudPostgresqlClaimWithAttemptCredential(
				{ kind: "claim-granted", messageId: "claim:1", ...claim.lease! },
				worker,
				"settlement:worker:missing-credential-driver",
				"message:worker:settle:missing-credential-driver",
				new AbortController().signal,
				() => 10,
				undefined as never,
				allowAuthorizationRecheckDriver(),
			),
		).rejects.toThrow(
			"attempt credential lifecycle and authorization recheck drivers are required",
		);
		expect(executed).toBe(false);
	});

	it("rejects credential lifecycle compatibility mismatch before executing workload", async () => {
		const store = new Store();
		await store.admit(
			{
				...(store.envelope ?? {}),
				kind: "managed-cloud-postgresql-admitted-envelope",
				...admissionEnvelope,
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
				sourceRefs: admissionSourceRefs,
			},
			10,
		);
		const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
		let executed = false;
		await expect(
			executeManagedCloudPostgresqlClaimWithAttemptCredential(
				{ kind: "claim-granted", messageId: "claim:1", ...claim.lease! },
				{
					compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
					async execute() {
						executed = true;
						return { outcome: "succeeded", outcomeRefs: [] };
					},
				},
				"settlement:worker:credential-mismatch",
				"message:worker:settle:credential-mismatch",
				new AbortController().signal,
				() => 10,
				{
					compatibility:
						"wrong-managed-cloud-credential-family" as typeof MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
					async prepareAttemptCredential() {
						throw new Error("must not run");
					},
					async cleanupAttemptCredential() {
						throw new Error("must not run");
					},
				},
				allowAuthorizationRecheckDriver(),
			),
		).rejects.toThrow("credential lifecycle compatibility mismatch");
		expect(executed).toBe(false);
	});

	it("rejects required-helper settlements that lack terminal credential cleanup", async () => {
		const store = new Store();
		await store.admit(
			{
				...(store.envelope ?? {}),
				kind: "managed-cloud-postgresql-admitted-envelope",
				...admissionEnvelope,
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
				sourceRefs: admissionSourceRefs,
			},
			10,
		);
		const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
		let executed = false;
		const settlement = await executeManagedCloudPostgresqlClaimWithAttemptCredential(
			{ kind: "claim-granted", messageId: "claim:1", ...claim.lease! },
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					executed = true;
					return { outcome: "succeeded", outcomeRefs: [{ kind: "artifact", id: "artifact:1" }] };
				},
			},
			"settlement:worker:credential-not-cleaned",
			"message:worker:settle:credential-not-cleaned",
			new AbortController().signal,
			() => 10,
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async prepareAttemptCredential() {
					return { ready: true, lifecycle: credentialLifecycleSequence().slice(0, 3) };
				},
				async cleanupAttemptCredential() {
					return { lifecycle: [] };
				},
			},
			allowAuthorizationRecheckDriver(),
		);
		expect(executed).toBe(true);
		expect(settlement).toMatchObject({
			outcome: "failed",
			issueRefs: [{ kind: "issue", id: "credential-cleanup-unverifiable" }],
		});
		expect(settlement.credentialLifecycle?.at(-1)).toMatchObject({
			state: "cleanup-unverifiable",
		});
	});

	it("rejects workload results that lack injected credential lifecycle posture", async () => {
		const store = new Store();
		await store.admit(
			{
				...(store.envelope ?? {}),
				kind: "managed-cloud-postgresql-admitted-envelope",
				...admissionEnvelope,
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
				sourceRefs: admissionSourceRefs,
			},
			10,
		);
		const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
		let executed = false;
		const settlement = await executeManagedCloudPostgresqlClaimWithAttemptCredential(
			{ kind: "claim-granted", messageId: "claim:1", ...claim.lease! },
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					executed = true;
					return { outcome: "succeeded", outcomeRefs: [{ kind: "artifact", id: "artifact:1" }] };
				},
			},
			"settlement:worker:credential-not-injected",
			"message:worker:settle:credential-not-injected",
			new AbortController().signal,
			() => 10,
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async prepareAttemptCredential() {
					return {
						ready: true,
						lifecycle: [credentialFact("issue-requested"), credentialFact("issued")],
					};
				},
				async cleanupAttemptCredential() {
					throw new Error("cleanup must not run");
				},
			},
			allowAuthorizationRecheckDriver(),
		);
		expect(executed).toBe(false);
		expect(settlement).toMatchObject({
			outcome: "failed",
			issueRefs: [{ id: "credential-preparation-unverifiable" }],
			credentialLifecycle: [{ state: "issue-requested" }, { state: "cleanup-unverifiable" }],
		});
	});

	it("terminates credential ownership when prepare, workload, or cleanup promises reject", async () => {
		const { runtime, store } = await activeRuntime();
		const claim = {
			kind: "claim-granted" as const,
			messageId: "message:claim:promise-failures",
			...lease,
			envelope: store.envelope!,
			leaseExpiresAtMs: 1010,
			heartbeatExpiresAtMs: 510,
		};
		let executed = false;
		let prepareCleanupCalled = false;
		const prepareFailure = await executeManagedCloudPostgresqlClaimWithAttemptCredential(
			claim,
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					executed = true;
					return { outcome: "succeeded", outcomeRefs: [] };
				},
			},
			"settlement:prepare-rejected",
			"message:settle:prepare-rejected",
			new AbortController().signal,
			() => 10,
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async prepareAttemptCredential() {
					throw new Error("prepare rejected");
				},
				async cleanupAttemptCredential() {
					prepareCleanupCalled = true;
					throw new Error("ownership is uncertain");
				},
			},
			allowAuthorizationRecheckDriver(),
		);
		expect(executed).toBe(false);
		expect(prepareCleanupCalled).toBe(true);
		expect(prepareFailure).toMatchObject({
			outcome: "failed",
			issueRefs: [{ id: "credential-preparation-unverifiable" }],
			credentialLifecycle: [{ state: "issue-requested" }, { state: "cleanup-unverifiable" }],
		});

		const cleanupFailure = await executeManagedCloudPostgresqlClaimWithAttemptCredential(
			claim,
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					return { outcome: "succeeded", outcomeRefs: [] };
				},
			},
			"settlement:cleanup-rejected",
			"message:settle:cleanup-rejected",
			new AbortController().signal,
			() => 10,
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async prepareAttemptCredential() {
					return { ready: true, lifecycle: credentialLifecycleSequence().slice(0, 3) };
				},
				async cleanupAttemptCredential() {
					throw new Error("cleanup rejected");
				},
			},
			allowAuthorizationRecheckDriver(),
		);
		expect(cleanupFailure).toMatchObject({
			outcome: "failed",
			issueRefs: [{ kind: "issue", id: "credential-cleanup-unverifiable" }],
		});
		expect(cleanupFailure.credentialLifecycle?.at(-1)).toMatchObject({
			state: "cleanup-unverifiable",
		});

		let workloadCleanupCalled = false;
		const workloadFailure = await executeManagedCloudPostgresqlClaimWithAttemptCredential(
			claim,
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					throw new Error("workload rejected");
				},
			},
			"settlement:workload-rejected",
			"message:settle:workload-rejected",
			new AbortController().signal,
			() => 10,
			readyCredentialDriver(undefined, () => {
				workloadCleanupCalled = true;
			}),
			allowAuthorizationRecheckDriver(),
		);
		expect(workloadCleanupCalled).toBe(true);
		expect(workloadFailure).toMatchObject({
			outcome: "failed",
			issueRefs: [{ id: "managed-cloud-workload-execution-failed" }],
		});
		expect(workloadFailure.credentialLifecycle?.at(-1)).toMatchObject({ state: "revoked" });
		await runtime.dispose();
	});

	it("fails closed and cleans up when the authority clock regresses before workload use", async () => {
		const { runtime, store } = await activeRuntime();
		const times = [100, 101, 0, 102];
		let executed = false;
		let cleaned = false;
		const settlement = await executeManagedCloudPostgresqlClaimWithAttemptCredential(
			{
				kind: "claim-granted",
				messageId: "message:claim:clock-regression",
				...lease,
				envelope: store.envelope!,
				leaseExpiresAtMs: 1010,
				heartbeatExpiresAtMs: 510,
			},
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					executed = true;
					return { outcome: "succeeded", outcomeRefs: [] };
				},
			},
			"settlement:clock-regression",
			"message:settle:clock-regression",
			new AbortController().signal,
			() => times.shift() ?? 102,
			readyCredentialDriver(undefined, () => {
				cleaned = true;
			}),
			{
				...allowAuthorizationRecheckDriver(),
				async authorizeCredentialIssuance(context) {
					return authorizationRecheck("credential-issuance", {
						...leaseCoordinatesPatch(context),
						credentialBindingRevision: context.credentialBindingRevision,
						observedAtMs: 100,
					});
				},
			},
		);
		expect(executed).toBe(false);
		expect(cleaned).toBe(true);
		expect(settlement).toMatchObject({
			outcome: "failed",
			issueRefs: [{ id: "authority-clock-regressed-before-workload" }],
		});
		expect(settlement.credentialLifecycle?.at(-1)).toMatchObject({ state: "revoked" });
		await runtime.dispose();
	});

	it("fails closed without executing workload when attempt credential issuance fails", async () => {
		const store = new Store();
		await store.admit(
			{
				...(store.envelope ?? {}),
				kind: "managed-cloud-postgresql-admitted-envelope",
				...admissionEnvelope,
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
				sourceRefs: admissionSourceRefs,
			},
			10,
		);
		const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
		let executed = false;
		const settlement = await executeManagedCloudPostgresqlClaimWithAttemptCredential(
			{ kind: "claim-granted", messageId: "claim:1", ...claim.lease! },
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					executed = true;
					return { outcome: "succeeded", outcomeRefs: [] };
				},
			},
			"settlement:worker:credential-unavailable",
			"message:worker:settle:credential-unavailable",
			new AbortController().signal,
			() => 10,
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async prepareAttemptCredential() {
					return {
						ready: false,
						lifecycle: [
							credentialFact("issue-requested"),
							credentialFact("unavailable", {
								issueRefs: [{ kind: "issue", id: "managed-cloud-attempt-unavailable" }],
							}),
						],
						issueRefs: [{ kind: "issue", id: "managed-cloud-attempt-unavailable" }],
					};
				},
				async cleanupAttemptCredential() {
					throw new Error("cleanup must not run");
				},
			},
			allowAuthorizationRecheckDriver(),
		);
		expect(executed).toBe(false);
		expect(settlement).toMatchObject({
			outcome: "failed",
			issueRefs: [{ id: "managed-cloud-attempt-unavailable" }],
			credentialLifecycle: [{ state: "issue-requested" }, { state: "unavailable" }],
		});
	});

	it("settles helper-produced unavailable credential issuance as failed runtime outcome", async () => {
		const { runtime, transport, store } = await activeRuntime();
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const facts = collect<ManagedCloudPostgresqlCredentialLifecycleFact>(
			runtime.credentialLifecycle,
		);
		let executed = false;
		const settlement = await executeManagedCloudPostgresqlClaimWithAttemptCredential(
			{
				kind: "claim-granted",
				messageId: "message:claim:credential-unavailable",
				...lease,
				envelope: store.envelope!,
				leaseExpiresAtMs: 1010,
				heartbeatExpiresAtMs: 510,
			},
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					executed = true;
					return { outcome: "succeeded", outcomeRefs: [] };
				},
			},
			"settlement:runtime:credential-unavailable",
			"message:runtime:settle:credential-unavailable",
			new AbortController().signal,
			() => 10,
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async prepareAttemptCredential() {
					return {
						ready: false,
						lifecycle: [
							credentialFact("issue-requested"),
							credentialFact("unavailable", {
								issueRefs: [{ kind: "issue", id: "managed-cloud-attempt-unavailable" }],
							}),
						],
						issueRefs: [{ kind: "issue", id: "managed-cloud-attempt-unavailable" }],
					};
				},
				async cleanupAttemptCredential() {
					throw new Error("cleanup must not run");
				},
			},
			allowAuthorizationRecheckDriver(),
		);
		transport.onMessage?.(settlement);
		await settle();
		expect(executed).toBe(false);
		expect(facts.map((fact) => fact.state)).toEqual(["issue-requested", "unavailable"]);
		expect(outcomes.at(-1)).toMatchObject({
			kind: "failure",
			error: { sourceRefs: [{ id: "managed-cloud-attempt-unavailable" }] },
			metadata: { issueRefs: [{ id: "managed-cloud-attempt-unavailable" }] },
		});
		expect(transport.sent).toContainEqual(
			expect.objectContaining({ kind: "accepted", operation: "settle" }),
		);
		await runtime.dispose();
	});

	it("rejects short, drifting, or stale-authorized attempt credentials before workload use", async () => {
		const store = new Store();
		await store.admit(
			{
				...(store.envelope ?? {}),
				kind: "managed-cloud-postgresql-admitted-envelope",
				...admissionEnvelope,
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
				sourceRefs: admissionSourceRefs,
			},
			10,
		);
		const claim = (await store.claim()) as ManagedCloudPostgresqlStoreResult;
		let executed = false;
		for (const lifecycleFacts of [
			[
				credentialFact("issue-requested"),
				credentialFact("issued", { expiresAtMs: 1009 }),
				credentialFact("injected", { expiresAtMs: 1009 }),
			],
			[
				credentialFact("issue-requested"),
				credentialFact("issued"),
				credentialFact("injected", { expiresAtMs: 1009 }),
			],
		]) {
			const invalidSettlement =
				await executeManagedCloudPostgresqlClaimWithAuthorizedAttemptCredential(
					{ kind: "claim-granted", messageId: "claim:expiry", ...claim.lease! },
					{
						compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
						async execute() {
							executed = true;
							return { outcome: "succeeded", outcomeRefs: [] };
						},
					},
					"settlement:expiry",
					"message:expiry",
					new AbortController().signal,
					() => 10,
					{
						compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
						async prepareAttemptCredential() {
							return { ready: true, lifecycle: lifecycleFacts };
						},
						async cleanupAttemptCredential() {
							throw new Error("cleanup must not run");
						},
					},
					allowAuthorizationRecheckDriver(),
				);
			expect(invalidSettlement).toMatchObject({
				outcome: "failed",
				issueRefs: [{ id: "credential-preparation-unverifiable" }],
				credentialLifecycle: [{ state: "issue-requested" }, { state: "cleanup-unverifiable" }],
			});
		}
		expect(executed).toBe(false);

		executed = false;
		const staleAuthorization = allowAuthorizationRecheckDriver();
		staleAuthorization.authorizeCredentialIssuance = async (context) =>
			authorizationRecheck("credential-issuance", {
				...leaseCoordinatesPatch(context),
				credentialBindingRevision: context.credentialBindingRevision,
				observedAtMs: 1010,
				authorizationExpiresAtMs: 10_100,
			});
		const settlement = await executeManagedCloudPostgresqlClaimWithAuthorizedAttemptCredential(
			{ kind: "claim-granted", messageId: "claim:stale-auth", ...claim.lease! },
			{
				compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
				async execute() {
					executed = true;
					return { outcome: "succeeded", outcomeRefs: [] };
				},
			},
			"settlement:stale-auth",
			"message:stale-auth",
			new AbortController().signal,
			() => 10,
			readyCredentialDriver(),
			staleAuthorization,
		);
		expect(executed).toBe(false);
		expect(settlement).toMatchObject({ outcome: "failed" });
	});

	it("accepts failed pre-injection cleanup and rejects the retired v1 wire protocol", async () => {
		const { runtime, transport } = await activeRuntime();
		const outcomes = collect(runtime.outcomes);
		const issues = collect<{ code: string }>(runtime.issues);
		transport.onMessage?.({
			kind: "settle",
			messageId: "message:settle:pre-injection",
			settlementId: "settlement:pre-injection",
			outcome: "failed",
			outcomeRefs: [],
			issueRefs: [{ kind: "issue", id: "credential-injection-failed" }],
			credentialLifecycle: [
				credentialFact("issue-requested"),
				credentialFact("issued"),
				credentialFact("revoking"),
				credentialFact("revoked"),
			],
			...lease,
		});
		await settle();
		expect(outcomes.at(-1)?.kind).toBe("failure");
		transport.onMessage?.({
			kind: "claim",
			messageId: "message:retired-v1",
			protocolRevision: "graphrefly-managed-cloud-wss-json-v1",
			workerId: "worker:1",
			sessionEpoch: "epoch:worker:1",
			environmentRevision: "environment-revision:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:retired-v1" },
		});
		await settle();
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "managed-cloud-envelope-invalid" }),
		);
		await runtime.dispose();

		const uncertain = await activeRuntime();
		const uncertainOutcomes = collect(uncertain.runtime.outcomes);
		let uncertainExecuted = false;
		const uncertainSettlement =
			await executeManagedCloudPostgresqlClaimWithAuthorizedAttemptCredential(
				{
					kind: "claim-granted",
					messageId: "message:claim:issuance-response-lost",
					...lease,
					envelope: uncertain.store.envelope!,
					leaseExpiresAtMs: 1010,
					heartbeatExpiresAtMs: 510,
				},
				{
					compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
					async execute() {
						uncertainExecuted = true;
						return { outcome: "succeeded", outcomeRefs: [] };
					},
				},
				"settlement:issuance-response-lost",
				"message:settle:issuance-response-lost",
				new AbortController().signal,
				() => 10,
				{
					compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
					async prepareAttemptCredential() {
						return {
							ready: false,
							lifecycle: [
								credentialFact("issue-requested"),
								credentialFact("cleanup-unverifiable", {
									issueRefs: [{ kind: "issue", id: "credential-cleanup-unverifiable" }],
								}),
							],
						};
					},
					async cleanupAttemptCredential() {
						throw new Error("cleanup posture is already terminal");
					},
				},
				allowAuthorizationRecheckDriver(),
			);
		uncertain.transport.onMessage?.(uncertainSettlement);
		await settle();
		expect(uncertainExecuted).toBe(false);
		expect(uncertainSettlement).toMatchObject({
			outcome: "failed",
			credentialLifecycle: [{ state: "issue-requested" }, { state: "cleanup-unverifiable" }],
		});
		expect(uncertainOutcomes.at(-1)?.kind).toBe("failure");
		await uncertain.runtime.dispose();
	});

	it("fails closed before durable admission for stale readiness or wrong locality", async () => {
		for (const candidate of [
			readiness({ state: "stale" }),
			readiness({ schemaVerified: false }),
			readiness({ credentialResolverReady: false }),
			readiness({
				state: "unavailable",
				deploymentProfile: "docker-compose-development",
			}),
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
				authorizationRecheck: allowAuthorizationRecheckDriver(),
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

	it("rejects forged admitted-envelope material returned by the store boundary", async () => {
		const store = new Store();
		store.claim = async () => ({
			accepted: true,
			code: "claimed",
			lease: {
				...lease,
				envelope: { ...store.envelope!, admissionId: "admission:attacker" },
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
			...admissionEnvelope,
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
			sourceRefs: admissionSourceRefs,
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
		expect(queries[0]?.sql).toContain("graphrefly_managed_cloud_v2");
		expect(queries[0]?.sql).not.toContain("graphrefly_managed_cloud_v1");
		expect(queries[0]?.sql).toContain("protocolRevision");
		expect(queries[1]?.sql).toMatch(/ON CONFLICT DO NOTHING/);
		expect(queries[1]?.sql).toContain("graphrefly_managed_cloud_v2");
		expect(queries[1]?.sql).toContain("$1");
		expect(queries[1]?.sql).not.toContain(envelope.runId);
		expect(queries[1]?.values[0]).toBe(envelope.runId);
		expect(queries[2]?.sql).toMatch(/FOR UPDATE SKIP LOCKED/);
		expect(queries[2]?.sql).toContain(
			"envelope->>'protocolRevision'='graphrefly-managed-cloud-wss-json-v2'",
		);
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
			credentialLifecycle: credentialLifecycleSequence(),
			...lease,
		});
		await settle();
		expect(outcomes).toHaveLength(0);
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "managed-cloud-settlement-reconciliation-required" }),
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
			authorizationRecheck: allowAuthorizationRecheckDriver(),
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
			credentialLifecycle: credentialLifecycleSequence().map((fact) => ({
				...fact,
				runId: "run:2",
			})),
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
				credentialLifecycle: credentialLifecycleSequence(),
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
		authorizationRecheck: allowAuthorizationRecheckDriver(),
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
