import {
	MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
	MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE,
	MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE,
	MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
	MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION,
	type ManagedCloudPostgresqlAuthorizationRecheckDriver,
	type ManagedCloudPostgresqlControlMessage,
	type ManagedCloudPostgresqlControlStoreDriver,
	type ManagedCloudPostgresqlLifecycleFact,
	type ManagedCloudPostgresqlManifest,
	type ManagedCloudPostgresqlReadiness,
	type ManagedCloudPostgresqlStoreResult,
	type ManagedCloudPostgresqlTransportDriver,
	managedCloudPostgresqlManifest,
	managedCloudPostgresqlReadiness,
	managedCloudPostgresqlRuntime,
} from "../../src/executors/managed-cloud-postgresql.js";
import { postgresqlToolProviderInputFromIntent } from "../../src/executors/postgresql-tool-provider.js";
import { graph } from "../../src/graph/graph.js";
import { compoundTupleKey } from "../../src/identity.js";
import type {
	ExecutorOutcome,
	ToolProviderAdapterRunRequested,
} from "../../src/orchestration/index.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	strictSnapshot,
} from "./canonical.js";
import {
	CURRENT_PUBLIC_CRITERION_FAILURES,
	type CurrentPublicCriterionFailure,
} from "./current-graph-native-eval-authority.js";

export const CURRENT_MANAGED_CLOUD_PUBLIC_SEMANTIC_SCHEMA =
	"graphrefly-ts.d1.managed-cloud-public-semantic-validation.v1" as const;
export const CURRENT_MANAGED_CLOUD_PUBLIC_SEMANTIC_SCENARIO_DIGESTS = Object.freeze([
	"sha256:5e0f3a5cf89c7c2ccef18c915e5131439f9fe0aff9dd1fcc2273144af1e4fdbd",
	"sha256:cdfb12bd9f999ec3e357da31457670ec250881203c7351369c9559aa757b2019",
	"sha256:cdfb12bd9f999ec3e357da31457670ec250881203c7351369c9559aa757b2019",
] as const);

export interface CurrentManagedCloudPublicSemanticValidationV1 {
	readonly schemaVersion: typeof CURRENT_MANAGED_CLOUD_PUBLIC_SEMANTIC_SCHEMA;
	readonly taskRef: "managed-cloud-postgresql-canonical-admission-proposal-ref";
	readonly criteriaRef: "graphrefly-ts.d1.public-managed-cloud-admission-criteria.v1";
	readonly status: "passed" | "failed";
	readonly criterionFailures: readonly CurrentPublicCriterionFailure[];
	readonly scenarioDigests: readonly string[];
	readonly publicCriteriaOnly: true;
	readonly hiddenVerifierMaterialUsed: false;
	readonly expectedPatchMaterialUsed: false;
	readonly evidenceDigest: string;
}

const canonicalAdmissionProposalId = compoundTupleKey("tool-provider-run-admission-proposal", [
	"candidate:run:1",
]);

function input() {
	return postgresqlToolProviderInputFromIntent(
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
}

function manifest(): ManagedCloudPostgresqlManifest {
	return managedCloudPostgresqlManifest({
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
	});
}

function readiness(): ManagedCloudPostgresqlReadiness {
	return managedCloudPostgresqlReadiness({
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
	});
}

function runWithProposal(
	metadataProposalId: string,
	producerProposalId: string,
	runId = "run:1",
): ToolProviderAdapterRunRequested {
	return {
		kind: "tool-provider-adapter-run-requested",
		runId,
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
			{ kind: "tool-provider-run-admission-proposal", id: producerProposalId },
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
			proposalId: metadataProposalId,
			decisionId: "admission-decision:1",
			executionEnvironmentId: "environment:managed",
			executionEnvironmentRevision: "environment-revision:1",
			executionEnvironmentLocality: "managed-cloud",
			executionEnvironmentBindingKind: "remote-session",
			executionSessionEpoch: "epoch:admission:1",
			executionManifestFingerprint: "fingerprint:cloud:pg:1",
		},
	};
}

function lifecycle(
	state: ManagedCloudPostgresqlLifecycleFact["state"],
): ManagedCloudPostgresqlLifecycleFact {
	return {
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
	};
}

class PublicStore implements ManagedCloudPostgresqlControlStoreDriver {
	readonly compatibility = MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE;
	readonly schemaRevision = MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION;
	readonly calls: string[] = [];
	private envelope?: Parameters<ManagedCloudPostgresqlControlStoreDriver["admit"]>[0];
	async admit(envelope: Parameters<ManagedCloudPostgresqlControlStoreDriver["admit"]>[0]) {
		this.calls.push("admit");
		this.envelope = envelope;
		return { accepted: true as const, code: "admitted", lifecycle: lifecycle("queued") };
	}
	async claim() {
		this.calls.push("claim");
		return {
			accepted: true as const,
			code: "claimed",
			lifecycle: lifecycle("claimed"),
			lease: {
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
				envelope: this.envelope!,
				leaseExpiresAtMs: 1010,
				heartbeatExpiresAtMs: 510,
			},
		};
	}
	async rejectClaim(_lease: NonNullable<ManagedCloudPostgresqlStoreResult["lease"]>, code: string) {
		return { accepted: true as const, code, lifecycle: { ...lifecycle("rejected"), code } };
	}
	async heartbeat() {
		return { accepted: true as const, code: "renewed", lifecycle: lifecycle("heartbeat-current") };
	}
	async persistCancellation() {
		return {
			accepted: true as const,
			code: "cancel-persisted",
			lifecycle: lifecycle("cancel-pending"),
		};
	}
	async acknowledgeCancellation() {
		return {
			accepted: true as const,
			code: "cancel-ack",
			lifecycle: lifecycle("cancel-acknowledged"),
		};
	}
	async settle(): Promise<ManagedCloudPostgresqlStoreResult> {
		const outcome: ExecutorOutcome = {
			kind: "canceled",
			outcomeId: "outcome:1",
			executorId: "executor:pg",
			profileId: "profile:pg",
			requestId: "request:1",
			operationId: "operation:1",
			routeId: "route:1",
			attempt: 1,
			inputId: this.envelope!.adapterInputId,
			inputKind: "tool-call",
			metadata: {},
			evidenceRefs: [],
			reason: "public-semantic-driver",
		};
		return { accepted: true, code: "settled", lifecycle: lifecycle("settled"), outcome };
	}
	async expire() {
		return [];
	}
	async disconnect() {
		return [];
	}
	async close() {}
}

class PublicTransport implements ManagedCloudPostgresqlTransportDriver {
	readonly protocolRevision = MANAGED_CLOUD_POSTGRESQL_PROTOCOL;
	readonly sent: ManagedCloudPostgresqlControlMessage[] = [];
	onMessage?: (message: unknown) => void;
	async start(onMessage: (message: unknown) => void) {
		this.onMessage = onMessage;
	}
	async send(_workerId: string, _epoch: string, message: ManagedCloudPostgresqlControlMessage) {
		this.sent.push(message);
	}
	async close() {}
}

const authorizationRecheck: ManagedCloudPostgresqlAuthorizationRecheckDriver = {
	compatibility: MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
	async authorizeClaim(request) {
		const lease = request.lease;
		return {
			kind: "managed-cloud-postgresql-authorization-recheck-result",
			stage: "claim",
			state: "allowed",
			runId: lease.runId,
			attempt: lease.attempt,
			environmentRevision: lease.environmentRevision,
			manifestFingerprint: lease.manifestFingerprint,
			leaseId: lease.leaseId,
			fencingToken: lease.fencingToken,
			workerId: lease.workerId,
			sessionEpoch: lease.sessionEpoch,
			deploymentRevision: lease.deploymentRevision,
			workerRevision: lease.workerRevision,
			requestId: "request:1",
			operationId: "operation:1",
			routeId: "route:1",
			executorId: "executor:pg",
			profileId: "profile:pg",
			adapterInputId: input().adapterInputId,
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
			admissionProposalId: canonicalAdmissionProposalId,
			admissionDecisionId: "admission-decision:1",
			decisionRef: "authorization-decision:claim:1",
			authorizationRevisionRef: "authorization-revision:31",
			authorizationExpiresAtMs: 10_100,
			grantGeneration: 11,
			grantHighWater: 31,
			observedAtMs: 10,
			issueRefs: [],
			auditRefs: [{ kind: "audit", id: "authorization-audit:claim:1" }],
		};
	},
	async authorizeCredentialIssuance() {
		throw new TypeError("public semantic driver does not issue credentials");
	},
};

function collect<T>(node: {
	subscribe(cb: (message: readonly [string, unknown?]) => void): () => void;
}) {
	const values: T[] = [];
	node.subscribe((message) => {
		if (message[0] === "DATA") values.push(message[1] as T);
	});
	return values;
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

async function scenario(candidate: ToolProviderAdapterRunRequested, claim: boolean) {
	const owner = graph();
	const inputs = owner.node([], null);
	const admitted = owner.node<ToolProviderAdapterRunRequested>([], null);
	const manifests = owner.node<ManagedCloudPostgresqlManifest>([], null);
	const postures = owner.node<ManagedCloudPostgresqlReadiness>([], null);
	const store = new PublicStore();
	const transport = new PublicTransport();
	const runtime = managedCloudPostgresqlRuntime(owner, {
		inputs: inputs as never,
		admittedRunRequests: [admitted],
		manifests: [manifests],
		readiness: [postures],
		store,
		transport,
		authorizationRecheck,
		now: () => 10,
	});
	const envelopes = collect(runtime.admittedEnvelopes);
	inputs.down([["DATA", input()]]);
	manifests.down([["DATA", manifest()]]);
	postures.down([["DATA", readiness()]]);
	admitted.down([["DATA", candidate]]);
	await settle();
	if (claim && envelopes.length === 1) {
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
	}
	return strictSnapshot({
		envelopeCount: envelopes.length,
		storeCalls: store.calls,
		claimGranted: transport.sent.some(
			(message) =>
				message.kind === "claim-granted" &&
				message.leaseId === "lease:1" &&
				message.fencingToken === 1,
		),
	});
}

export async function runCurrentManagedCloudPublicSemanticValidation(): Promise<CurrentManagedCloudPublicSemanticValidationV1> {
	const canonical = await scenario(
		runWithProposal(canonicalAdmissionProposalId, canonicalAdmissionProposalId),
		true,
	);
	const malformedProposalId =
		'tool-provider-run-admission-proposal:["candidate:run:1",{"private":"value"}]';
	const malformed = await scenario(
		runWithProposal(malformedProposalId, malformedProposalId, "run:malformed"),
		false,
	);
	const locallyReconstructedProposalId = compoundTupleKey("tool-provider-run-admission-proposal", [
		"candidate:run:locally-reconstructed",
	]);
	const local = await scenario(
		runWithProposal(
			locallyReconstructedProposalId,
			canonicalAdmissionProposalId,
			"run:locally-reconstructed",
		),
		false,
	);
	const failures: CurrentPublicCriterionFailure[] = [];
	if (canonical.envelopeCount !== 1) failures.push("canonical-proposal-not-admitted");
	if (malformed.envelopeCount !== 0 || malformed.storeCalls.length !== 0)
		failures.push("malformed-provenance-not-rejected");
	if (local.envelopeCount !== 0 || local.storeCalls.length !== 0)
		failures.push("local-reconstruction-not-rejected");
	if (
		JSON.stringify(canonical.storeCalls) !== JSON.stringify(["admit", "claim"]) ||
		!canonical.claimGranted
	)
		failures.push("authorization-claim-invariant-regressed");
	for (const failure of failures)
		if (!CURRENT_PUBLIC_CRITERION_FAILURES.includes(failure))
			throw new TypeError("current public semantic driver emitted an unknown criterion");
	const material = strictSnapshot({
		schemaVersion: CURRENT_MANAGED_CLOUD_PUBLIC_SEMANTIC_SCHEMA,
		taskRef: "managed-cloud-postgresql-canonical-admission-proposal-ref" as const,
		criteriaRef: "graphrefly-ts.d1.public-managed-cloud-admission-criteria.v1" as const,
		status: failures.length === 0 ? ("passed" as const) : ("failed" as const),
		criterionFailures: Object.freeze(failures),
		scenarioDigests: Object.freeze([
			empiricalStrictJsonDigest(canonical),
			empiricalStrictJsonDigest(malformed),
			empiricalStrictJsonDigest(local),
		]),
		publicCriteriaOnly: true as const,
		hiddenVerifierMaterialUsed: false as const,
		expectedPatchMaterialUsed: false as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export function validateCurrentManagedCloudPublicSemanticValidation(
	value: unknown,
): CurrentManagedCloudPublicSemanticValidationV1 {
	const candidate = record(value, "current.publicSemanticEvidence");
	exactKeys(
		candidate,
		[
			"criteriaRef",
			"criterionFailures",
			"evidenceDigest",
			"expectedPatchMaterialUsed",
			"hiddenVerifierMaterialUsed",
			"publicCriteriaOnly",
			"scenarioDigests",
			"schemaVersion",
			"status",
			"taskRef",
		],
		"current.publicSemanticEvidence",
	);
	if (
		candidate.schemaVersion !== CURRENT_MANAGED_CLOUD_PUBLIC_SEMANTIC_SCHEMA ||
		candidate.taskRef !== "managed-cloud-postgresql-canonical-admission-proposal-ref" ||
		candidate.criteriaRef !== "graphrefly-ts.d1.public-managed-cloud-admission-criteria.v1" ||
		candidate.publicCriteriaOnly !== true ||
		candidate.hiddenVerifierMaterialUsed !== false ||
		candidate.expectedPatchMaterialUsed !== false
	)
		throw new TypeError("current public semantic evidence coordinates drifted");
	const failures = array(
		candidate.criterionFailures,
		"current.publicSemanticEvidence.criterionFailures",
	);
	if (failures.length > CURRENT_PUBLIC_CRITERION_FAILURES.length)
		throw new TypeError("current public semantic criterion bound drifted");
	for (const failure of failures)
		oneOf(
			failure,
			CURRENT_PUBLIC_CRITERION_FAILURES,
			"current.publicSemanticEvidence.criterionFailure",
		);
	if (new Set(failures).size !== failures.length)
		throw new TypeError("current public semantic criterion uniqueness drifted");
	const status = oneOf(
		candidate.status,
		["passed", "failed"] as const,
		"current.publicSemanticEvidence.status",
	);
	if ((status === "passed") !== (failures.length === 0))
		throw new TypeError("current public semantic result cardinality drifted");
	const scenarioDigests = array(
		candidate.scenarioDigests,
		"current.publicSemanticEvidence.scenarioDigests",
	);
	if (scenarioDigests.length !== 3)
		throw new TypeError("current public semantic scenario cardinality drifted");
	for (const scenarioDigest of scenarioDigests)
		digest(scenarioDigest, "current.publicSemanticEvidence.scenarioDigest");
	if (
		status === "passed" &&
		empiricalStrictJsonDigest(scenarioDigests) !==
			empiricalStrictJsonDigest(CURRENT_MANAGED_CLOUD_PUBLIC_SEMANTIC_SCENARIO_DIGESTS)
	)
		throw new TypeError("current public semantic passed-scenario identity drifted");
	const evidenceDigest = digest(
		candidate.evidenceDigest,
		"current.publicSemanticEvidence.evidenceDigest",
	);
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		taskRef: candidate.taskRef,
		criteriaRef: candidate.criteriaRef,
		status,
		criterionFailures: failures,
		scenarioDigests,
		publicCriteriaOnly: candidate.publicCriteriaOnly,
		hiddenVerifierMaterialUsed: candidate.hiddenVerifierMaterialUsed,
		expectedPatchMaterialUsed: candidate.expectedPatchMaterialUsed,
	});
	if (empiricalStrictJsonDigest(material) !== evidenceDigest)
		throw new TypeError("current public semantic evidence digest drifted");
	return Object.freeze({
		...material,
		evidenceDigest,
	}) as CurrentManagedCloudPublicSemanticValidationV1;
}
