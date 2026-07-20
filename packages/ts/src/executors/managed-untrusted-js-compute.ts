/** Concrete managed untrusted JavaScript compute executor (D612). */
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import {
	type AgentOutputEnvelope,
	type AgentRuntimeAuditRecord,
	buildToolProviderExecutorOutcome,
	type ExecutorOutcome,
	type ExecutorUsage,
	type SourceRef,
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunRequested,
	type ToolProviderAdapterRunStatus,
} from "../orchestration/index.js";
import type { ExecutionEnvironmentPinnedRunMetadata } from "./execution-environment.js";

export const MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY =
	"graphrefly-managed-untrusted-js-compute-v2" as const;
export const MANAGED_UNTRUSTED_JS_COMPUTE_BACKEND = "e2b-cloud-v0" as const;

export interface ManagedUntrustedJsComputeArguments {
	readonly contractVersion: "1";
	readonly bundleDigest: string;
	readonly bundleRevision: string;
	readonly templateBuildId: string;
	readonly runnerRevision: string;
	readonly inputRefs: readonly SourceRef[];
	readonly artifactRefs?: readonly SourceRef[];
	readonly resourcePolicyRevision: string;
	readonly outputPolicyRevision: string;
	readonly networkPolicyRevision: "deny-all-external-v1";
}

export interface ManagedUntrustedJsComputeManifest {
	readonly kind: "managed-untrusted-js-compute-manifest";
	readonly manifestId: string;
	readonly revision: string;
	readonly fingerprint: string;
	readonly compatibilityRevision: typeof MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY;
	readonly backend: typeof MANAGED_UNTRUSTED_JS_COMPUTE_BACKEND;
	readonly templateBuildId: string;
	readonly runnerRevision: string;
	readonly resourcePolicyRevision: string;
	readonly outputPolicyRevision: string;
	readonly networkPolicyRevision: "deny-all-external-v1";
	readonly sandboxPolicyRevision: string;
	readonly cleanupPolicyRevision: string;
	readonly executionTimeoutMs: number;
	readonly killGraceMs: number;
	readonly cleanupTimeoutMs: number;
	readonly attestationRefs: readonly SourceRef[];
}

export interface ManagedUntrustedJsComputeReadiness {
	readonly kind: "managed-untrusted-js-compute-readiness";
	readonly manifestFingerprint: string;
	readonly state: "ready" | "stale" | "unavailable";
	readonly observedAtMs: number;
	readonly expiresAtMs: number;
	readonly e2bReachable: boolean;
	readonly templateVerified: boolean;
	readonly runnerVerified: boolean;
	readonly denyNetworkVerified: boolean;
	readonly freshSandboxReady: boolean;
	readonly artifactResolverReady: boolean;
	readonly quotaReady: boolean;
	readonly attestationRefs: readonly SourceRef[];
}

export type ManagedUntrustedJsComputeLifecycleState =
	| "admitted"
	| "creating"
	| "uploading"
	| "running"
	| "cancel-requested"
	| "kill-requested"
	| "destroying"
	| "settled";

export interface ManagedUntrustedJsComputeLifecycleFact {
	readonly kind: "managed-untrusted-js-compute-lifecycle-fact";
	readonly state: ManagedUntrustedJsComputeLifecycleState;
	readonly runId: string;
	readonly attempt: number;
	readonly environmentRevision: string;
	readonly manifestFingerprint: string;
	readonly epoch: string;
	readonly occurredAtMs: number;
	readonly evidenceRefs?: readonly SourceRef[];
}

export interface ManagedUntrustedJsComputeCleanupStatus {
	readonly kind: "managed-untrusted-js-compute-cleanup-status";
	readonly runId: string;
	readonly attempt: number;
	readonly epoch: string;
	readonly state: "succeeded" | "failed" | "unverifiable";
	readonly issueRefs?: readonly SourceRef[];
}

export interface ManagedUntrustedJsComputeMovementEvidence {
	readonly kind: "managed-untrusted-js-compute-movement-evidence";
	readonly runId: string;
	readonly attempt: number;
	readonly epoch: string;
	readonly direction: "host-to-sandbox" | "sandbox-to-host";
	readonly classification: "bundle" | "input-artifact" | "result-artifact" | "bounded-log-ref";
	readonly bytes: number;
	readonly truncated: boolean;
	readonly artifactRefs?: readonly SourceRef[];
}

export interface ManagedUntrustedJsComputeCancellationRequested {
	readonly kind: "managed-untrusted-js-compute-cancellation-requested";
	readonly cancellationId: string;
	readonly runId: string;
	readonly adapterInputId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly runAdmissionId: string;
	readonly attempt: number;
	readonly environmentId: string;
	readonly environmentRevision: string;
	readonly manifestFingerprint: string;
	readonly epoch: string;
}

/** Exact-attempt cancellation candidate; publishing it has no execution side effect. */
export interface ManagedUntrustedJsComputeCancellationProposal
	extends Omit<ManagedUntrustedJsComputeCancellationRequested, "kind"> {
	readonly kind: "managed-untrusted-js-compute-cancellation-proposal";
	readonly proposalId: string;
}

/** Host-authored cancellation authority result for one exact proposal. */
export interface ManagedUntrustedJsComputeCancellationDecision
	extends Omit<ManagedUntrustedJsComputeCancellationRequested, "kind"> {
	readonly kind: "managed-untrusted-js-compute-cancellation-decision";
	readonly decisionId: string;
	readonly proposalId: string;
	readonly outcome: "admit" | "block";
	readonly sourceRefs: readonly SourceRef[];
}

/** Graph-visible cancellation admission; only `admitted` may reach the private driver. */
export interface ManagedUntrustedJsComputeCancellationAdmission
	extends Omit<ManagedUntrustedJsComputeCancellationProposal, "kind"> {
	readonly kind: "managed-untrusted-js-compute-cancellation-admission";
	readonly admissionId: string;
	readonly decisionId: string;
	readonly state: "admitted" | "blocked";
	readonly sourceRefs: readonly SourceRef[];
}

export interface ManagedUntrustedJsComputeCancellationAcknowledgement {
	readonly kind: "managed-untrusted-js-compute-cancellation-acknowledgement";
	readonly proposalId: string;
	readonly admissionId: string;
	readonly cancellationId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly epoch: string;
	readonly state:
		| "accepted-before-allocation"
		| "allocation-fenced"
		| "kill-requested"
		| "rejected";
	readonly code?: string;
}

export interface ManagedUntrustedJsComputeDriverContext {
	readonly runId: string;
	readonly attempt: number;
	readonly environmentRevision: string;
	readonly manifestFingerprint: string;
	readonly epoch: string;
	readonly signal: AbortSignal;
}

export type ManagedUntrustedJsComputeAllocationFenceContext = Omit<
	ManagedUntrustedJsComputeDriverContext,
	"signal"
>;

export type ManagedUntrustedJsComputeDriverResult =
	| {
			readonly outcome: "succeeded";
			readonly resultRefs: readonly SourceRef[];
			readonly artifactRefs?: readonly SourceRef[];
			readonly usage?: ExecutorUsage;
			readonly movement?: readonly ManagedUntrustedJsComputeMovementEvidence[];
	  }
	| {
			readonly outcome: "failed" | "timeout";
			readonly issue: DataIssue;
			readonly artifactRefs?: readonly SourceRef[];
			readonly usage?: ExecutorUsage;
			readonly movement?: readonly ManagedUntrustedJsComputeMovementEvidence[];
	  }
	| {
			readonly outcome: "canceled";
			readonly reason?: string;
			readonly artifactRefs?: readonly SourceRef[];
			readonly usage?: ExecutorUsage;
			readonly movement?: readonly ManagedUntrustedJsComputeMovementEvidence[];
	  };

/** E2B client/API-key/sandbox IDs/URLs/PTYs/commands/handles stay inside this driver. */
export interface ManagedUntrustedJsComputeDriver {
	readonly compatibility: typeof MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY;
	createSandbox(
		context: ManagedUntrustedJsComputeDriverContext,
		args: ManagedUntrustedJsComputeArguments,
		manifest: ManagedUntrustedJsComputeManifest,
	): unknown | PromiseLike<unknown>;
	upload(
		sandbox: unknown,
		context: ManagedUntrustedJsComputeDriverContext,
		args: ManagedUntrustedJsComputeArguments,
	): void | PromiseLike<void>;
	run(
		sandbox: unknown,
		context: ManagedUntrustedJsComputeDriverContext,
		args: ManagedUntrustedJsComputeArguments,
	): ManagedUntrustedJsComputeDriverResult | PromiseLike<ManagedUntrustedJsComputeDriverResult>;
	kill(
		sandbox: unknown,
		context: ManagedUntrustedJsComputeDriverContext,
		graceMs: number,
	): void | PromiseLike<void>;
	destroy(
		sandbox: unknown,
		context: ManagedUntrustedJsComputeDriverContext,
	): "succeeded" | "failed" | "unverifiable" | PromiseLike<"succeeded" | "failed" | "unverifiable">;
	/**
	 * Synchronously accepts ownership of the exact in-flight createSandbox call identified by
	 * context. The returned value reports cleanup evidence; execution cancellation cannot revoke the
	 * ownership transfer.
	 */
	fenceAllocation(
		context: ManagedUntrustedJsComputeAllocationFenceContext,
	):
		| ManagedUntrustedJsComputeCleanupStatus["state"]
		| PromiseLike<ManagedUntrustedJsComputeCleanupStatus["state"]>;
}

export interface ManagedUntrustedJsComputeRuntimeOptions {
	readonly name?: string;
	readonly inputs: Node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>;
	readonly admittedRunRequests: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly manifests: readonly Node<ManagedUntrustedJsComputeManifest>[];
	readonly readiness: readonly Node<ManagedUntrustedJsComputeReadiness>[];
	readonly cancellationRequests?: readonly Node<ManagedUntrustedJsComputeCancellationRequested>[];
	readonly cancellationDecisions?: readonly Node<ManagedUntrustedJsComputeCancellationDecision>[];
	readonly driver: ManagedUntrustedJsComputeDriver;
	readonly now?: () => number;
}

export interface ManagedUntrustedJsComputeRuntimeBundle {
	readonly admittedRunRequests: Node<ToolProviderAdapterRunRequested>;
	readonly runStatus: Node<ToolProviderAdapterRunStatus>;
	readonly lifecycle: Node<ManagedUntrustedJsComputeLifecycleFact>;
	readonly cleanup: Node<ManagedUntrustedJsComputeCleanupStatus>;
	readonly movement: Node<ManagedUntrustedJsComputeMovementEvidence>;
	readonly outcomes: Node<ExecutorOutcome>;
	readonly cancellationProposals: Node<ManagedUntrustedJsComputeCancellationProposal>;
	readonly cancellationAdmissions: Node<ManagedUntrustedJsComputeCancellationAdmission>;
	readonly cancellations: Node<ManagedUntrustedJsComputeCancellationAcknowledgement>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	dispose(): Promise<void>;
}

interface Active {
	readonly input: ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>;
	readonly request: ToolProviderAdapterRunRequested;
	readonly runAdmissionId: string;
	readonly manifest: ManagedUntrustedJsComputeManifest;
	readonly context: ManagedUntrustedJsComputeDriverContext;
	readonly abortController: AbortController;
	readonly disposeSignal: Promise<"disposed">;
	readonly resolveDispose: () => void;
	readonly cancelSignal: Promise<"canceled">;
	readonly resolveCancel: () => void;
	sandbox?: unknown;
	admissionPublished: boolean;
	cancellationDeliveryReserved: boolean;
	cancelRequested: boolean;
	cancelled: boolean;
	timedOut: boolean;
	settled: boolean;
	destroyed: boolean;
	cleanupPublished: boolean;
	destroyingPublished: boolean;
	publishCleanupRequested: boolean;
	killRequired: boolean;
	allocationPromise?: Promise<void>;
	allocationStarted: boolean;
	allocationSettled: boolean;
	allocationFenced: boolean;
	allocationFenceAttempted: boolean;
	allocationFencePromise?: Promise<ManagedUntrustedJsComputeCleanupStatus["state"]>;
	killPromise?: Promise<boolean>;
	killCompletion?: Promise<boolean>;
	killState?: boolean;
	killSettledWithinDeadline?: boolean;
	destroyPromise?: Promise<void>;
	postKillDestroyScheduled: boolean;
	destroyState?: ManagedUntrustedJsComputeCleanupStatus["state"];
	cleanupDeadlineAtMs?: number;
	pendingCancellationProposalId?: string;
	readonly cancellationIds: Map<string, string>;
	readonly cancellationDecisionIds: Map<string, string>;
	acceptedCancellation?: ManagedUntrustedJsComputeCancellationAdmission;
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const REF_ID_SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-[\]",]{0,511}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_REFS = 32;
const MAX_MOVEMENT = 16;
const MAX_MOVEMENT_BYTES = 64 * 1024 * 1024;
const MAX_CLEANUP_TIMEOUT_MS = 5 * 60_000;
const MAX_CANCELLATIONS_PER_ATTEMPT = 32;
const MAX_GENERATED_CANCELLATION_ID_CHARS = 8 * 1024;
const PRIVATE_REF_TERMS = [
	"apikey",
	"client",
	"command",
	"credential",
	"dsn",
	"e2bapikey",
	"endpoint",
	"handle",
	"openbao",
	"password",
	"private",
	"pty",
	"sandboxid",
	"secret",
	"socket",
	"spiffe",
	"svid",
	"token",
	"url",
	"vault",
];

export function managedUntrustedJsComputeManifest(
	value: ManagedUntrustedJsComputeManifest,
): ManagedUntrustedJsComputeManifest {
	if (!plain(value) || value.kind !== "managed-untrusted-js-compute-manifest")
		throw new TypeError("Invalid managed untrusted JS compute manifest.");
	if (
		!exactKeys(value, [
			"kind",
			"manifestId",
			"revision",
			"fingerprint",
			"compatibilityRevision",
			"backend",
			"templateBuildId",
			"runnerRevision",
			"resourcePolicyRevision",
			"outputPolicyRevision",
			"networkPolicyRevision",
			"sandboxPolicyRevision",
			"cleanupPolicyRevision",
			"executionTimeoutMs",
			"killGraceMs",
			"cleanupTimeoutMs",
			"attestationRefs",
		]) ||
		value.compatibilityRevision !== MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY ||
		value.backend !== MANAGED_UNTRUSTED_JS_COMPUTE_BACKEND ||
		value.networkPolicyRevision !== "deny-all-external-v1" ||
		!positive(value.executionTimeoutMs) ||
		!positive(value.killGraceMs) ||
		!positive(value.cleanupTimeoutMs) ||
		value.cleanupTimeoutMs <= value.killGraceMs ||
		value.cleanupTimeoutMs > MAX_CLEANUP_TIMEOUT_MS
	)
		throw new TypeError("Invalid managed untrusted JS compute manifest.");
	for (const id of [
		value.manifestId,
		value.revision,
		value.fingerprint,
		value.templateBuildId,
		value.runnerRevision,
		value.resourcePolicyRevision,
		value.outputPolicyRevision,
		value.sandboxPolicyRevision,
		value.cleanupPolicyRevision,
	])
		assertSafe(id, "manifest coordinate");
	return Object.freeze({
		...value,
		attestationRefs: refs(value.attestationRefs),
	});
}

export function managedUntrustedJsComputeReadiness(
	value: ManagedUntrustedJsComputeReadiness,
): ManagedUntrustedJsComputeReadiness {
	if (!plain(value) || value.kind !== "managed-untrusted-js-compute-readiness")
		throw new TypeError("Invalid managed untrusted JS compute readiness.");
	if (
		!exactKeys(value, [
			"kind",
			"manifestFingerprint",
			"state",
			"observedAtMs",
			"expiresAtMs",
			"e2bReachable",
			"templateVerified",
			"runnerVerified",
			"denyNetworkVerified",
			"freshSandboxReady",
			"artifactResolverReady",
			"quotaReady",
			"attestationRefs",
		]) ||
		!["ready", "stale", "unavailable"].includes(value.state) ||
		!Number.isSafeInteger(value.observedAtMs) ||
		!Number.isSafeInteger(value.expiresAtMs)
	)
		throw new TypeError("Invalid managed untrusted JS compute readiness.");
	assertSafe(value.manifestFingerprint, "readiness manifest fingerprint");
	return Object.freeze({ ...value, attestationRefs: refs(value.attestationRefs) });
}

export function managedUntrustedJsComputeArguments(
	value: ManagedUntrustedJsComputeArguments,
): ManagedUntrustedJsComputeArguments {
	if (!plain(value) || value.contractVersion !== "1")
		throw new TypeError("Invalid managed untrusted JS compute arguments.");
	if (
		!exactKeysOptional(
			value,
			[
				"contractVersion",
				"bundleDigest",
				"bundleRevision",
				"templateBuildId",
				"runnerRevision",
				"inputRefs",
				"resourcePolicyRevision",
				"outputPolicyRevision",
				"networkPolicyRevision",
			],
			["artifactRefs"],
		) ||
		!DIGEST.test(value.bundleDigest) ||
		value.networkPolicyRevision !== "deny-all-external-v1"
	)
		throw new TypeError("Invalid managed untrusted JS compute arguments.");
	for (const id of [
		value.bundleRevision,
		value.templateBuildId,
		value.runnerRevision,
		value.resourcePolicyRevision,
		value.outputPolicyRevision,
		value.networkPolicyRevision,
	])
		assertSafe(id, "compute argument coordinate");
	return Object.freeze({
		contractVersion: "1",
		bundleDigest: value.bundleDigest,
		bundleRevision: value.bundleRevision,
		templateBuildId: value.templateBuildId,
		runnerRevision: value.runnerRevision,
		inputRefs: refs(value.inputRefs),
		...(value.artifactRefs === undefined ? {} : { artifactRefs: refs(value.artifactRefs) }),
		resourcePolicyRevision: value.resourcePolicyRevision,
		outputPolicyRevision: value.outputPolicyRevision,
		networkPolicyRevision: value.networkPolicyRevision,
	});
}

export function managedUntrustedJsComputeRuntime(
	graph: Graph,
	opts: ManagedUntrustedJsComputeRuntimeOptions,
): ManagedUntrustedJsComputeRuntimeBundle {
	if (opts.driver.compatibility !== MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY)
		throw new TypeError("Managed untrusted JS compute driver compatibility mismatch.");
	if (
		(opts.cancellationRequests?.length ?? 0) > 0 !==
		(opts.cancellationDecisions?.length ?? 0) > 0
	)
		throw new TypeError(
			"Managed untrusted JS compute cancellation requires request and decision nodes.",
		);
	const name = opts.name ?? "managedUntrustedJsCompute";
	const group = graph.topologyGroup({ name });
	const admittedRunRequests = group.node<ToolProviderAdapterRunRequested>([], null, {
		name: `${name}/admittedRunRequests`,
		factory: "managedUntrustedJsComputeAdmittedRunRequests",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const runStatus = group.node<ToolProviderAdapterRunStatus>([], null, {
		name: `${name}/runStatus`,
		factory: "managedUntrustedJsComputeRunStatus",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const lifecycle = group.node<ManagedUntrustedJsComputeLifecycleFact>([], null, {
		name: `${name}/lifecycle`,
		factory: "managedUntrustedJsComputeLifecycle",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const cleanup = group.node<ManagedUntrustedJsComputeCleanupStatus>([], null, {
		name: `${name}/cleanup`,
		factory: "managedUntrustedJsComputeCleanup",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const movement = group.node<ManagedUntrustedJsComputeMovementEvidence>([], null, {
		name: `${name}/movement`,
		factory: "managedUntrustedJsComputeMovement",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const outcomes = group.node<ExecutorOutcome>([], null, {
		name: `${name}/outcomes`,
		factory: "managedUntrustedJsComputeOutcomes",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const cancellationProposals = group.node<ManagedUntrustedJsComputeCancellationProposal>(
		[],
		null,
		{
			name: `${name}/cancellationProposals`,
			factory: "managedUntrustedJsComputeCancellationProposals",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const cancellationAdmissions = group.node<ManagedUntrustedJsComputeCancellationAdmission>(
		[],
		null,
		{
			name: `${name}/cancellationAdmissions`,
			factory: "managedUntrustedJsComputeCancellationAdmissions",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const cancellations = group.node<ManagedUntrustedJsComputeCancellationAcknowledgement>([], null, {
		name: `${name}/cancellations`,
		factory: "managedUntrustedJsComputeCancellations",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const issues = group.node<DataIssue>([], null, {
		name: `${name}/issues`,
		factory: "managedUntrustedJsComputeIssues",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const audit = group.node<AgentRuntimeAuditRecord>([], null, {
		name: `${name}/audit`,
		factory: "managedUntrustedJsComputeAudit",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const inputs = new Map<string, ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>();
	let manifest: ManagedUntrustedJsComputeManifest | undefined;
	let posture: ManagedUntrustedJsComputeReadiness | undefined;
	const active = new Map<string, Active>();
	const allocating = new Set<Active>();
	const cancellationProposalsById = new Map<
		string,
		ManagedUntrustedJsComputeCancellationProposal
	>();
	const terminal = new Set<string>();
	const pending = new Set<Promise<unknown>>();
	let disposed = false;
	let disposePromise: Promise<void> | undefined;
	let disposeComplete = false;
	let releasePending = true;
	const now = opts.now ?? Date.now;
	const ensureCleanupDeadline = (record: Active) =>
		(record.cleanupDeadlineAtMs ??= Date.now() + record.manifest.cleanupTimeoutMs);
	const remainingCleanupTime = (record: Active) =>
		Math.max(1, ensureCleanupDeadline(record) - Date.now());
	const emit = <T>(node: Node<T>, value: T) => node.down([["DATA", value]]);
	const issue = (code: string, message: string, refs?: readonly string[]) =>
		emit(issues, {
			kind: "issue",
			code,
			message,
			severity: "error",
			...(refs === undefined ? {} : { refs }),
		});
	const track = (work: Promise<unknown>) => {
		pending.add(work);
		void work.finally(() => pending.delete(work));
	};
	const runAsync = (work: () => Promise<void>, code: string) =>
		track(
			work().catch(() => {
				issue(code, "Managed untrusted JS compute runtime-private operation failed.");
			}),
		);
	const emitLifecycle = (
		state: ManagedUntrustedJsComputeLifecycleState,
		record: Active,
		evidenceRefs?: readonly SourceRef[],
		generatedCancellationEvidence = false,
	) => {
		const safeEvidenceRefs =
			evidenceRefs === undefined
				? undefined
				: generatedCancellationEvidence
					? Object.freeze(evidenceRefs.map((source) => Object.freeze({ ...source })))
					: refs(evidenceRefs);
		const fact: ManagedUntrustedJsComputeLifecycleFact = Object.freeze({
			kind: "managed-untrusted-js-compute-lifecycle-fact",
			state,
			runId: record.request.runId,
			attempt: record.request.attempt,
			environmentRevision: record.context.environmentRevision,
			manifestFingerprint: record.context.manifestFingerprint,
			epoch: record.context.epoch,
			occurredAtMs: now(),
			...(safeEvidenceRefs === undefined ? {} : { evidenceRefs: safeEvidenceRefs }),
		});
		emit(lifecycle, fact);
		emit(audit, {
			id: `managed-untrusted-js-compute-audit:${fact.runId}:${fact.attempt}:${fact.state}:${fact.occurredAtMs}`,
			kind: `managed-untrusted-js-compute-${fact.state}`,
			subjectId: fact.runId,
			metadata: {
				attempt: fact.attempt,
				environmentRevision: fact.environmentRevision,
				manifestFingerprint: fact.manifestFingerprint,
				epoch: fact.epoch,
			},
			...(fact.evidenceRefs === undefined ? {} : { sourceRefs: fact.evidenceRefs }),
		});
	};
	const cancellationCoordinates = (
		value: Omit<ManagedUntrustedJsComputeCancellationRequested, "kind">,
	): Record<string, unknown> => ({
		cancellationId: value.cancellationId,
		runId: value.runId,
		adapterInputId: value.adapterInputId,
		requestId: value.requestId,
		operationId: value.operationId,
		routeId: value.routeId,
		executorId: value.executorId,
		profileId: value.profileId,
		runAdmissionId: value.runAdmissionId,
		attempt: value.attempt,
		environmentId: value.environmentId,
		environmentRevision: value.environmentRevision,
		manifestFingerprint: value.manifestFingerprint,
		epoch: value.epoch,
	});
	const cancellationEvidenceRefs = (
		admission: ManagedUntrustedJsComputeCancellationAdmission,
	): readonly SourceRef[] => [
		{ kind: "managed-untrusted-js-compute-cancellation", id: admission.cancellationId },
		{ kind: "managed-untrusted-js-compute-cancellation-proposal", id: admission.proposalId },
		{ kind: "managed-untrusted-js-compute-cancellation-decision", id: admission.decisionId },
		{ kind: "managed-untrusted-js-compute-cancellation-admission", id: admission.admissionId },
		...admission.sourceRefs,
	];
	const emitCancellationAudit = (
		kind: string,
		subjectId: string,
		metadata: Record<string, unknown>,
		sourceRefs?: readonly SourceRef[],
		issueCode?: string,
	) =>
		emit(audit, {
			id: compoundTupleKey("managed-untrusted-js-compute-cancellation-audit", [kind, subjectId]),
			kind,
			subjectId,
			...(sourceRefs === undefined ? {} : { sourceRefs }),
			...(issueCode === undefined ? {} : { issueCode }),
			metadata,
		});
	const unsubscribes = [
		opts.inputs.subscribe((m) => {
			if (m[0] !== "DATA") return;
			const input = snapshotInput(m[1]);
			if (input === undefined) {
				issue("managed-untrusted-js-compute-input-invalid", "Compute input is invalid.");
				return;
			}
			inputs.set(input.adapterInputId, input);
		}),
		...opts.manifests.map((node) =>
			node.subscribe((m) => {
				if (m[0] !== "DATA") return;
				try {
					manifest = managedUntrustedJsComputeManifest(m[1] as ManagedUntrustedJsComputeManifest);
				} catch {
					issue("managed-untrusted-js-compute-manifest-invalid", "Compute manifest is invalid.");
				}
			}),
		),
		...opts.readiness.map((node) =>
			node.subscribe((m) => {
				if (m[0] !== "DATA") return;
				try {
					posture = managedUntrustedJsComputeReadiness(m[1] as ManagedUntrustedJsComputeReadiness);
				} catch {
					issue("managed-untrusted-js-compute-readiness-invalid", "Compute readiness is invalid.");
				}
			}),
		),
		...opts.admittedRunRequests.map((node) =>
			node.subscribe((m) => {
				if (m[0] !== "DATA" || disposed) return;
				const request = m[1] as ToolProviderAdapterRunRequested;
				runAsync(async () => {
					const key = activeKey(request);
					if (active.has(key) || terminal.has(key)) {
						issue(
							"managed-untrusted-js-compute-duplicate-run",
							"Managed untrusted JS compute run attempt was already active or settled.",
							refIds(request.sourceRefs ?? []),
						);
						emit(
							runStatus,
							status(request, "stale-request", "managed-untrusted-js-compute-duplicate-run"),
						);
						return;
					}
					const activeRecord = admit(request, inputs, manifest, posture, now());
					if ("issue" in activeRecord) {
						issue(activeRecord.issue.code, activeRecord.issue.message, activeRecord.issue.refs);
						emit(runStatus, status(request, activeRecord.status, activeRecord.issue.code));
						return;
					}
					active.set(key, activeRecord);
					emitLifecycle("admitted", activeRecord, request.sourceRefs);
					emit(runStatus, status(request, "requested"));
					activeRecord.admissionPublished = true;
					if (disposed) return;
					emit(admittedRunRequests, request);
					if (disposed) return;
					await execute(activeRecord);
				}, "managed-untrusted-js-compute-driver-failed");
			}),
		),
		...(opts.cancellationRequests ?? []).map((node) =>
			node.subscribe((m) => {
				if (m[0] !== "DATA" || disposed) return;
				const request = snapshotCancellation(m[1]);
				if (request === undefined) {
					issue("managed-untrusted-js-compute-cancellation-invalid", "Cancellation is invalid.");
					return;
				}
				const record = active.get(activeKey(request));
				if (
					record === undefined ||
					!record.admissionPublished ||
					!cancellationMatchesRecord(request, record)
				) {
					issue(
						"managed-untrusted-js-compute-cancellation-coordinate-mismatch",
						"Cancellation did not exactly match the active managed compute attempt.",
					);
					return;
				}
				if (
					record.pendingCancellationProposalId !== undefined ||
					record.cancellationDeliveryReserved ||
					record.cancelRequested
				) {
					issue(
						"managed-untrusted-js-compute-cancellation-proposal-outstanding",
						"The managed compute attempt already has an outstanding or admitted cancellation.",
					);
					return;
				}
				const priorProposalId = record.cancellationIds.get(request.cancellationId);
				if (priorProposalId !== undefined) {
					issue(
						"managed-untrusted-js-compute-cancellation-duplicate",
						"Cancellation identity was already proposed.",
					);
					return;
				}
				if (record.cancellationIds.size >= MAX_CANCELLATIONS_PER_ATTEMPT) {
					issue(
						"managed-untrusted-js-compute-cancellation-capacity-exceeded",
						"The managed compute attempt exceeded its bounded cancellation intent capacity.",
					);
					return;
				}
				const proposalId = compoundTupleKey("managed-untrusted-js-compute-cancellation-proposal", [
					request.cancellationId,
					request.runId,
					request.adapterInputId,
					request.requestId,
					request.operationId,
					request.routeId,
					request.executorId,
					request.profileId,
					request.runAdmissionId,
					String(request.attempt),
					request.environmentId,
					request.environmentRevision,
					request.manifestFingerprint,
					request.epoch,
				]);
				if (!generatedCancellationIdentity(proposalId)) {
					issue(
						"managed-untrusted-js-compute-cancellation-identity-too-large",
						"Cancellation coordinates exceeded the bounded canonical identity envelope.",
					);
					return;
				}
				const proposal: ManagedUntrustedJsComputeCancellationProposal = Object.freeze({
					...request,
					kind: "managed-untrusted-js-compute-cancellation-proposal",
					proposalId,
				});
				record.cancellationIds.set(request.cancellationId, proposalId);
				record.pendingCancellationProposalId = proposalId;
				cancellationProposalsById.set(proposalId, proposal);
				emitCancellationAudit(
					"managed-untrusted-js-compute-cancellation-proposed",
					proposal.proposalId,
					{
						...cancellationCoordinates(proposal),
						proposalId: proposal.proposalId,
					},
				);
				emit(cancellationProposals, proposal);
			}),
		),
		...(opts.cancellationDecisions ?? []).map((node) =>
			node.subscribe((m) => {
				if (m[0] !== "DATA" || disposed) return;
				const decision = snapshotCancellationDecision(m[1]);
				if (decision === undefined) {
					issue(
						"managed-untrusted-js-compute-cancellation-decision-invalid",
						"Cancellation decision is invalid.",
					);
					return;
				}
				const proposal = cancellationProposalsById.get(decision.proposalId);
				if (proposal === undefined) {
					issue(
						"managed-untrusted-js-compute-cancellation-decision-missing-proposal",
						"Cancellation decision had no current proposal.",
					);
					return;
				}
				if (!cancellationCoordinatesMatch(decision, proposal)) {
					issue(
						"managed-untrusted-js-compute-cancellation-decision-coordinate-mismatch",
						"Cancellation decision did not exactly match its proposal.",
					);
					return;
				}
				const record = active.get(activeKey(proposal));
				const priorDecisionProposalId = record?.cancellationDecisionIds.get(decision.decisionId);
				if (priorDecisionProposalId !== undefined) {
					issue(
						priorDecisionProposalId === decision.proposalId
							? "managed-untrusted-js-compute-cancellation-decision-duplicate"
							: "managed-untrusted-js-compute-cancellation-decision-conflict",
						"Cancellation decision identity was already consumed.",
					);
					return;
				}
				if (
					record !== undefined &&
					record.cancellationDecisionIds.size >= MAX_CANCELLATIONS_PER_ATTEMPT
				) {
					issue(
						"managed-untrusted-js-compute-cancellation-decision-capacity-exceeded",
						"The managed compute attempt exceeded its bounded cancellation decision capacity.",
					);
					return;
				}
				const admissionId = compoundTupleKey(
					"managed-untrusted-js-compute-cancellation-admission",
					[proposal.proposalId, decision.decisionId],
				);
				if (!generatedCancellationIdentity(admissionId)) {
					issue(
						"managed-untrusted-js-compute-cancellation-identity-too-large",
						"Cancellation admission exceeded the bounded canonical identity envelope.",
					);
					return;
				}
				record?.cancellationDecisionIds.set(decision.decisionId, decision.proposalId);
				cancellationProposalsById.delete(decision.proposalId);
				if (record?.pendingCancellationProposalId === decision.proposalId)
					record.pendingCancellationProposalId = undefined;
				const admitted =
					decision.outcome === "admit" &&
					record !== undefined &&
					record.admissionPublished &&
					cancellationMatchesRecord(proposal, record) &&
					!record.settled &&
					!record.cancelRequested &&
					!record.cancellationDeliveryReserved &&
					!record.timedOut &&
					(!record.allocationSettled || record.sandbox !== undefined || !record.allocationStarted);
				const admission: ManagedUntrustedJsComputeCancellationAdmission = Object.freeze({
					...proposal,
					kind: "managed-untrusted-js-compute-cancellation-admission",
					admissionId,
					decisionId: decision.decisionId,
					state: admitted ? "admitted" : "blocked",
					sourceRefs: decision.sourceRefs,
				});
				if (admitted && record !== undefined) record.cancellationDeliveryReserved = true;
				emitCancellationAudit(
					`managed-untrusted-js-compute-cancellation-${admission.state}`,
					admission.admissionId,
					{
						...cancellationCoordinates(admission),
						proposalId: admission.proposalId,
						decisionId: admission.decisionId,
						admissionId: admission.admissionId,
					},
					cancellationEvidenceRefs(admission),
					admitted ? undefined : "managed-untrusted-js-compute-cancellation-blocked",
				);
				emit(cancellationAdmissions, admission);
				if (!admitted)
					issue(
						"managed-untrusted-js-compute-cancellation-blocked",
						"Managed untrusted JS compute cancellation was blocked by current admission.",
						refIds(admission.sourceRefs),
					);
				if (admitted && record !== undefined && !disposed)
					runAsync(
						() => deliverCancellation(record, admission),
						"managed-untrusted-js-compute-cancellation-delivery-failed",
					);
			}),
		),
	];
	const execute = async (record: Active) => {
		let timedOut = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const timeoutSignal = new Promise<"timeout">((resolve) => {
			timeout = setTimeout(() => {
				timedOut = true;
				record.timedOut = true;
				record.killRequired = true;
				if (record.allocationStarted && !record.allocationSettled && record.sandbox === undefined)
					void fenceAllocationOnce(record);
				else if (record.sandbox !== undefined) void killOnce(record);
				record.abortController.abort();
				resolve("timeout");
			}, record.manifest.executionTimeoutMs);
		});
		const assertCurrent = () => {
			if (timedOut || disposed || record.cancelled)
				throw new TypeError("Managed untrusted JS compute is no longer current.");
		};
		const runDriver = async (): Promise<ManagedUntrustedJsComputeDriverResult> => {
			if (record.input.toolCall?.arguments === undefined)
				throw new TypeError("Managed untrusted JS compute arguments are missing.");
			const args = managedUntrustedJsComputeArguments(record.input.toolCall.arguments);
			emitLifecycle("creating", record);
			assertCurrent();
			allocating.add(record);
			record.allocationStarted = true;
			record.allocationPromise = Promise.resolve(
				opts.driver.createSandbox(record.context, args, record.manifest),
			)
				.then((sandbox) => {
					if (!record.allocationFenced) record.sandbox = sandbox;
				})
				.finally(() => {
					record.allocationSettled = true;
					allocating.delete(record);
				});
			await record.allocationPromise;
			assertCurrent();
			emitLifecycle("uploading", record);
			assertCurrent();
			await opts.driver.upload(record.sandbox, record.context, args);
			assertCurrent();
			emitLifecycle("running", record);
			assertCurrent();
			const result = snapshotDriverResult(
				await opts.driver.run(record.sandbox, record.context, args),
				record,
			);
			assertCurrent();
			return result;
		};
		try {
			const driverWork = runDriver();
			void driverWork
				.catch(() => undefined)
				.finally(async () => {
					if (record.killRequired && record.sandbox !== undefined && !record.destroyed) {
						await killOnce(record);
						await destroy(record, false);
					}
				});
			const result = await Promise.race([
				driverWork,
				timeoutSignal,
				record.disposeSignal,
				record.cancelSignal,
			]);
			if (result === "disposed") return;
			if (disposed) return;
			if (result === "canceled") {
				record.settled = true;
				emit(
					outcomes,
					outcome(record, {
						outcome: "canceled",
						reason: "managed-untrusted-js-compute-canceled",
					}),
				);
				emit(runStatus, status(record.request, "canceled"));
				return;
			}
			if (record.cancelRequested && record.killPromise !== undefined) await record.killPromise;
			if (record.cancelled)
				throw new TypeError("Managed untrusted JS compute is no longer current.");
			if (result === "timeout") {
				await killOnce(record);
				if (disposed) return;
				record.settled = true;
				emit(
					outcomes,
					outcome(record, {
						outcome: "timeout",
						issue: {
							kind: "issue",
							code: "managed-untrusted-js-compute-timeout",
							message: "Managed untrusted JS compute timed out.",
							severity: "error",
						},
					}),
				);
				emit(runStatus, status(record.request, "timeout", "managed-untrusted-js-compute-timeout"));
				return;
			}
			record.settled = true;
			for (const fact of result.movement ?? []) emit(movement, fact);
			emit(outcomes, outcome(record, result));
			emit(runStatus, status(record.request, outcomeStatus(result)));
		} catch (caught) {
			if (disposed) return;
			if (timedOut) {
				await killOnce(record);
				if (disposed) return;
				record.settled = true;
				emit(
					outcomes,
					outcome(record, {
						outcome: "timeout",
						issue: {
							kind: "issue",
							code: "managed-untrusted-js-compute-timeout",
							message: "Managed untrusted JS compute timed out.",
							severity: "error",
						},
					}),
				);
				emit(runStatus, status(record.request, "timeout", "managed-untrusted-js-compute-timeout"));
				return;
			}
			if (record.cancelRequested && record.killPromise !== undefined) await record.killPromise;
			if (disposed) return;
			const cancellationObserved = record.cancelled || record.cancelRequested;
			if (cancellationObserved) record.cancelled = true;
			const problem = {
				code: cancellationObserved
					? "managed-untrusted-js-compute-canceled"
					: "managed-untrusted-js-compute-failed",
				message: cancellationObserved
					? "Managed untrusted JS compute was cancelled."
					: "Managed untrusted JS compute failed closed.",
				severity: "error" as const,
			};
			record.settled = true;
			emit(
				outcomes,
				outcome(record, {
					outcome: cancellationObserved ? "canceled" : "failed",
					...(cancellationObserved
						? { reason: "managed-untrusted-js-compute-canceled" }
						: { issue: problem }),
				} as ManagedUntrustedJsComputeDriverResult),
			);
			emit(runStatus, status(record.request, cancellationObserved ? "canceled" : "failure"));
			if (!cancellationObserved) issue(problem.code, problem.message);
			void caught;
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
			await destroy(record, !disposed);
			if (!disposed)
				emitLifecycle(
					"settled",
					record,
					record.acceptedCancellation === undefined
						? undefined
						: cancellationEvidenceRefs(record.acceptedCancellation),
					record.acceptedCancellation !== undefined,
				);
			const key = activeKey(record.request);
			if (record.pendingCancellationProposalId !== undefined)
				cancellationProposalsById.delete(record.pendingCancellationProposalId);
			active.delete(key);
			terminal.add(key);
		}
	};
	const boundedProviderWork = <T>(
		work: Promise<T>,
		timeoutMs: number,
	): Promise<
		{ readonly state: "fulfilled"; readonly value: T } | { readonly state: "rejected" | "timeout" }
	> =>
		new Promise((resolve) => {
			let settled = false;
			const finish = (
				result:
					| { readonly state: "fulfilled"; readonly value: T }
					| { readonly state: "rejected" | "timeout" },
			) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				resolve(result);
			};
			const timeout = setTimeout(() => finish({ state: "timeout" }), timeoutMs);
			void work.then(
				(value) => finish({ state: "fulfilled", value }),
				() => finish({ state: "rejected" }),
			);
		});
	const fenceAllocationOnce = (
		record: Active,
	): Promise<ManagedUntrustedJsComputeCleanupStatus["state"]> | undefined => {
		if (record.allocationFencePromise !== undefined) return record.allocationFencePromise;
		if (record.allocationFenceAttempted) return undefined;
		let evidence:
			| ManagedUntrustedJsComputeCleanupStatus["state"]
			| PromiseLike<ManagedUntrustedJsComputeCleanupStatus["state"]>;
		try {
			evidence = opts.driver.fenceAllocation(
				Object.freeze({
					runId: record.context.runId,
					attempt: record.context.attempt,
					environmentRevision: record.context.environmentRevision,
					manifestFingerprint: record.context.manifestFingerprint,
					epoch: record.context.epoch,
				}),
			);
		} catch {
			return undefined;
		}
		record.allocationFenceAttempted = true;
		ensureCleanupDeadline(record);
		record.allocationFenced = true;
		record.allocationFencePromise = boundedProviderWork(
			Promise.resolve(evidence),
			remainingCleanupTime(record),
		).then((result) => {
			const state =
				result.state === "fulfilled" &&
				(["succeeded", "failed", "unverifiable"] as const).includes(result.value)
					? result.value
					: "unverifiable";
			record.destroyState = state;
			return state;
		});
		return record.allocationFencePromise;
	};
	const killOnce = (record: Active): Promise<boolean> => {
		if (record.killPromise !== undefined) return record.killPromise;
		if (record.sandbox === undefined) return Promise.resolve(false);
		record.killCompletion = Promise.resolve()
			.then(() => opts.driver.kill(record.sandbox, record.context, record.manifest.killGraceMs))
			.then(
				() => true,
				() => false,
			);
		record.killPromise = (async () => {
			const result = await boundedProviderWork(
				record.killCompletion as Promise<boolean>,
				remainingCleanupTime(record),
			);
			record.killSettledWithinDeadline = result.state === "fulfilled";
			record.killState = result.state === "fulfilled" && result.value;
			if (record.killState) record.cancelled = record.cancelRequested;
			return record.killState;
		})();
		return record.killPromise;
	};
	const publishCancellationAcknowledgement = (
		admission: ManagedUntrustedJsComputeCancellationAdmission,
		state: ManagedUntrustedJsComputeCancellationAcknowledgement["state"],
		code?: string,
	) => {
		const acknowledgement: ManagedUntrustedJsComputeCancellationAcknowledgement = Object.freeze({
			kind: "managed-untrusted-js-compute-cancellation-acknowledgement",
			proposalId: admission.proposalId,
			admissionId: admission.admissionId,
			cancellationId: admission.cancellationId,
			runId: admission.runId,
			attempt: admission.attempt,
			epoch: admission.epoch,
			state,
			...(code === undefined ? {} : { code }),
		});
		emit(cancellations, acknowledgement);
		emitCancellationAudit(
			`managed-untrusted-js-compute-cancellation-delivery-${state}`,
			admission.admissionId,
			{
				...cancellationCoordinates(admission),
				proposalId: admission.proposalId,
				decisionId: admission.decisionId,
				admissionId: admission.admissionId,
			},
			cancellationEvidenceRefs(admission),
			code,
		);
	};
	const deliverCancellation = async (
		record: Active,
		admission: ManagedUntrustedJsComputeCancellationAdmission,
	) => {
		if (
			record.settled ||
			record.cancelRequested ||
			!record.cancellationDeliveryReserved ||
			!cancellationMatchesRecord(admission, record)
		)
			return;
		if (!record.allocationStarted) {
			record.cancelRequested = true;
			record.cancelled = true;
			record.acceptedCancellation = admission;
			emitLifecycle("cancel-requested", record, cancellationEvidenceRefs(admission), true);
			record.abortController.abort();
			publishCancellationAcknowledgement(admission, "accepted-before-allocation");
			record.resolveCancel();
			return;
		}
		if (!record.allocationSettled && record.sandbox === undefined) {
			void fenceAllocationOnce(record);
			if (!record.allocationFenced) {
				record.cancellationDeliveryReserved = false;
				issue(
					"managed-untrusted-js-compute-cancellation-allocation-fence-unavailable",
					"Managed compute cancellation could not fence the pending allocation.",
				);
				publishCancellationAcknowledgement(admission, "rejected", "allocation-fence-unavailable");
				return;
			}
			record.cancelRequested = true;
			record.cancelled = true;
			record.killRequired = true;
			record.acceptedCancellation = admission;
			emitLifecycle("cancel-requested", record, cancellationEvidenceRefs(admission), true);
			record.abortController.abort();
			publishCancellationAcknowledgement(admission, "allocation-fenced");
			record.resolveCancel();
			return;
		}
		if (record.sandbox === undefined) {
			record.cancellationDeliveryReserved = false;
			publishCancellationAcknowledgement(admission, "rejected", "not-current");
			return;
		}
		record.cancelRequested = true;
		record.killRequired = true;
		record.acceptedCancellation = admission;
		emitLifecycle("cancel-requested", record, cancellationEvidenceRefs(admission), true);
		record.abortController.abort();
		emitLifecycle("kill-requested", record);
		publishCancellationAcknowledgement(admission, "kill-requested");
		const delivered = await killOnce(record);
		if (disposed) return;
		if (delivered) return;
		issue(
			"managed-untrusted-js-compute-cancellation-kill-failed",
			"Managed untrusted JS compute cancellation kill was not delivered.",
		);
		emitCancellationAudit(
			"managed-untrusted-js-compute-cancellation-delivery-failed",
			admission.admissionId,
			{
				...cancellationCoordinates(admission),
				proposalId: admission.proposalId,
				decisionId: admission.decisionId,
				admissionId: admission.admissionId,
			},
			cancellationEvidenceRefs(admission),
			"managed-untrusted-js-compute-cancellation-kill-failed",
		);
	};
	const startDestroy = async (record: Active) => {
		if (record.destroyPromise === undefined) {
			record.destroyed = true;
			record.destroyPromise = (async () => {
				if (record.publishCleanupRequested && releasePending) publishDestroying(record);
				const result = await boundedProviderWork(
					Promise.resolve().then(() => opts.driver.destroy(record.sandbox, record.context)),
					remainingCleanupTime(record),
				);
				record.destroyState = result.state === "fulfilled" ? result.value : "unverifiable";
				if (record.publishCleanupRequested) publishCleanup(record, record.destroyState);
			})();
		}
		await record.destroyPromise;
	};
	const destroy = async (record: Active, publish = true) => {
		if (publish) record.publishCleanupRequested = true;
		if (record.sandbox === undefined) {
			if (record.allocationFenced && record.allocationFencePromise !== undefined)
				await record.allocationFencePromise;
			if (record.publishCleanupRequested)
				publishCleanup(
					record,
					!record.allocationStarted
						? "succeeded"
						: record.allocationFenced && record.destroyState !== undefined
							? record.destroyState
							: "unverifiable",
				);
			return;
		}
		if (record.killPromise !== undefined) await record.killPromise;
		if (
			record.killRequired &&
			record.killState === false &&
			record.killSettledWithinDeadline !== true &&
			record.killCompletion !== undefined
		) {
			if (!record.postKillDestroyScheduled) {
				record.postKillDestroyScheduled = true;
				void record.killCompletion.then(() => startDestroy(record)).catch(() => undefined);
			}
			if (record.publishCleanupRequested) publishCleanup(record, "unverifiable");
			return;
		}
		await startDestroy(record);
		if (publish && record.destroyState !== undefined && !record.cleanupPublished)
			publishCleanup(record, record.destroyState);
	};
	const publishDestroying = (record: Active) => {
		if (record.destroyingPublished || record.sandbox === undefined) return;
		record.destroyingPublished = true;
		emitLifecycle("destroying", record);
	};
	const publishCleanup = (
		record: Active,
		state: ManagedUntrustedJsComputeCleanupStatus["state"],
	) => {
		if (record.cleanupPublished) return;
		record.cleanupPublished = true;
		emit(cleanup, {
			kind: "managed-untrusted-js-compute-cleanup-status",
			runId: record.request.runId,
			attempt: record.request.attempt,
			epoch: record.context.epoch,
			state,
			...(state === "succeeded"
				? {}
				: {
						issueRefs: [
							{
								kind: "issue",
								id: `managed-untrusted-js-compute-cleanup-${state}`,
							},
						],
					}),
		});
		if (state !== "succeeded")
			issue(
				`managed-untrusted-js-compute-cleanup-${state}`,
				"Managed untrusted JS compute sandbox cleanup was not proven.",
			);
	};
	const tryRelease = () => {
		if (!releasePending) return;
		try {
			group.release({ reason: `${name}:dispose` });
			releasePending = false;
		} catch {}
	};
	return {
		admittedRunRequests,
		runStatus,
		lifecycle,
		cleanup,
		movement,
		outcomes,
		cancellationProposals,
		cancellationAdmissions,
		cancellations,
		issues,
		audit,
		dispose() {
			if (disposePromise === undefined) {
				disposed = true;
				disposePromise = Promise.resolve()
					.then(async () => {
						for (const unsubscribe of unsubscribes) unsubscribe();
						const records = [...new Set([...active.values(), ...allocating])];
						for (const record of records) {
							ensureCleanupDeadline(record);
							if (record.allocationPromise !== undefined && !record.allocationSettled)
								void fenceAllocationOnce(record);
							if (!record.settled || allocating.has(record)) {
								record.killRequired = true;
								record.cancelled = true;
								if (record.sandbox !== undefined) void killOnce(record);
								record.resolveDispose();
								record.abortController.abort();
							}
						}
						await Promise.allSettled(
							records.map(async (record) => {
								if (record.allocationPromise === undefined || record.allocationSettled) return;
								await Promise.race([
									record.allocationPromise,
									record.allocationFencePromise,
									new Promise<void>((resolve) => setTimeout(resolve, remainingCleanupTime(record))),
								]);
							}),
						);
						await Promise.allSettled(
							records
								.map((record) => record.allocationFencePromise)
								.filter(
									(work): work is Promise<ManagedUntrustedJsComputeCleanupStatus["state"]> =>
										work !== undefined,
								),
						);
						const unresolvedAllocations = [...records].filter(
							(record) => record.allocationPromise !== undefined && !record.allocationSettled,
						);
						await Promise.allSettled(
							records.map(async (record) => {
								if (record.killRequired && record.sandbox !== undefined) void killOnce(record);
								if (record.killPromise !== undefined) await record.killPromise;
								await destroy(record).catch(() => undefined);
							}),
						);
						for (const record of unresolvedAllocations) {
							if (record.allocationFencePromise === undefined)
								issue(
									"managed-untrusted-js-compute-allocation-fence-unavailable",
									"Managed untrusted JS compute allocation could not be fenced before disposal.",
								);
						}
						const pendingTimeoutMs = Math.max(1, ...records.map(remainingCleanupTime));
						await Promise.race([
							Promise.allSettled([...pending]),
							new Promise<void>((resolve) => setTimeout(resolve, pendingTimeoutMs)),
						]);
						active.clear();
						allocating.clear();
						terminal.clear();
						cancellationProposalsById.clear();
						tryRelease();
					})
					.finally(() => {
						disposeComplete = true;
					});
			} else if (disposeComplete && releasePending) {
				disposeComplete = false;
				disposePromise = Promise.resolve()
					.then(tryRelease)
					.finally(() => {
						disposeComplete = true;
					});
			}
			return disposePromise;
		},
	};
}

function admit(
	request: ToolProviderAdapterRunRequested,
	inputs: Map<string, ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>,
	manifest: ManagedUntrustedJsComputeManifest | undefined,
	readiness: ManagedUntrustedJsComputeReadiness | undefined,
	now: number,
): Active | { readonly status: ToolProviderAdapterRunStatus["status"]; readonly issue: DataIssue } {
	const input = inputs.get(request.adapterInputId);
	if (input === undefined)
		return failure("missing-input", "managed-untrusted-js-compute-input-missing", request);
	if (input.status !== "ready" || input.toolCall === undefined)
		return failure("missing-input", "managed-untrusted-js-compute-input-not-ready", request);
	if (manifest === undefined || readiness === undefined || !ready(manifest, readiness, now))
		return failure("missing-request", "managed-untrusted-js-compute-not-ready", request);
	if (input.toolCall.arguments === undefined)
		return failure("missing-input", "managed-untrusted-js-compute-arguments-missing", request);
	const args = managedUntrustedJsComputeArguments(input.toolCall.arguments);
	const runAdmissionRefs =
		request.sourceRefs?.filter((source) => source.kind === "admission") ?? [];
	if (
		args.templateBuildId !== manifest.templateBuildId ||
		args.runnerRevision !== manifest.runnerRevision ||
		args.resourcePolicyRevision !== manifest.resourcePolicyRevision ||
		args.outputPolicyRevision !== manifest.outputPolicyRevision ||
		args.networkPolicyRevision !== manifest.networkPolicyRevision
	)
		return failure("mismatched-request", "managed-untrusted-js-compute-manifest-mismatch", request);
	if (
		input.adapterInputId !== request.adapterInputId ||
		input.requestId !== request.requestId ||
		input.operationId !== request.operationId ||
		input.routeId === undefined ||
		input.routeId !== request.routeId ||
		input.executorId === undefined ||
		input.executorId !== request.executorId ||
		input.profileId === undefined ||
		input.profileId !== request.profileId ||
		runAdmissionRefs.length !== 1
	)
		return failure("mismatched-request", "managed-untrusted-js-compute-request-mismatch", request);
	const meta = request.metadata as Partial<ExecutionEnvironmentPinnedRunMetadata> | undefined;
	if (
		meta?.executionEnvironmentLocality !== "managed-cloud" ||
		meta.executionEnvironmentBindingKind !== "remote-session" ||
		meta.executionEnvironmentId === undefined ||
		meta.executionEnvironmentRevision === undefined ||
		meta.executionManifestFingerprint !== manifest.fingerprint
	)
		return failure(
			"mismatched-request",
			"managed-untrusted-js-compute-environment-mismatch",
			request,
		);
	const epoch = meta.executionSessionEpoch;
	try {
		assertSafe(meta.executionEnvironmentId, "execution environment");
		assertSafe(meta.executionEnvironmentRevision, "execution environment revision");
		if (typeof epoch !== "string") throw new TypeError("Invalid execution session epoch.");
		assertSafe(epoch, "execution session epoch");
	} catch {
		return failure("mismatched-request", "managed-untrusted-js-compute-epoch-invalid", request);
	}
	const abortController = new AbortController();
	let resolveDispose = () => {};
	const disposeSignal = new Promise<"disposed">((resolve) => {
		resolveDispose = () => resolve("disposed");
	});
	let resolveCancel = () => {};
	const cancelSignal = new Promise<"canceled">((resolve) => {
		resolveCancel = () => resolve("canceled");
	});
	return {
		input,
		request,
		runAdmissionId: runAdmissionRefs[0]!.id,
		manifest,
		context: {
			runId: request.runId,
			attempt: request.attempt,
			environmentRevision: meta.executionEnvironmentRevision,
			manifestFingerprint: manifest.fingerprint,
			epoch,
			signal: abortController.signal,
		},
		abortController,
		disposeSignal,
		resolveDispose,
		cancelSignal,
		resolveCancel,
		admissionPublished: false,
		cancellationDeliveryReserved: false,
		cancelRequested: false,
		cancelled: false,
		timedOut: false,
		settled: false,
		destroyed: false,
		cleanupPublished: false,
		destroyingPublished: false,
		publishCleanupRequested: false,
		killRequired: false,
		allocationStarted: false,
		allocationSettled: false,
		allocationFenced: false,
		allocationFenceAttempted: false,
		postKillDestroyScheduled: false,
		cancellationIds: new Map(),
		cancellationDecisionIds: new Map(),
	};
}

function failure(
	status: ToolProviderAdapterRunStatus["status"],
	code: string,
	request: ToolProviderAdapterRunRequested,
): { readonly status: ToolProviderAdapterRunStatus["status"]; readonly issue: DataIssue } {
	return {
		status,
		issue: {
			kind: "issue",
			code,
			message: "Managed untrusted JS compute admission failed closed.",
			severity: "error",
			refs: refIds(request.sourceRefs ?? []),
		},
	};
}

function ready(
	manifest: ManagedUntrustedJsComputeManifest,
	readiness: ManagedUntrustedJsComputeReadiness,
	now: number,
) {
	return (
		readiness.manifestFingerprint === manifest.fingerprint &&
		readiness.state === "ready" &&
		readiness.expiresAtMs > now &&
		readiness.e2bReachable &&
		readiness.templateVerified &&
		readiness.runnerVerified &&
		readiness.denyNetworkVerified &&
		readiness.freshSandboxReady &&
		readiness.artifactResolverReady &&
		readiness.quotaReady
	);
}

function snapshotInput(
	raw: unknown,
): ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments> | undefined {
	if (!plain(raw) || raw.kind !== "tool-provider-adapter-input") return undefined;
	const input = raw as unknown as ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>;
	try {
		if (
			typeof input.adapterInputId !== "string" ||
			typeof input.requestId !== "string" ||
			typeof input.operationId !== "string" ||
			input.toolCall === undefined ||
			input.status !== "ready"
		)
			return undefined;
		for (const value of [
			input.adapterInputId,
			input.requestId,
			input.operationId,
			input.routeId,
			input.executorId,
			input.profileId,
		])
			if (value !== undefined) assertSafe(value, "input coordinate");
		if (input.toolCall.arguments === undefined) return undefined;
		const args = managedUntrustedJsComputeArguments(input.toolCall.arguments);
		return Object.freeze({ ...input, toolCall: { ...input.toolCall, arguments: args } });
	} catch {
		return undefined;
	}
}

function snapshotCancellation(
	raw: unknown,
): ManagedUntrustedJsComputeCancellationRequested | undefined {
	if (
		!plain(raw) ||
		hasAccessorOrExoticObject(raw) ||
		raw.kind !== "managed-untrusted-js-compute-cancellation-requested" ||
		!exactKeys(raw, [
			"kind",
			"cancellationId",
			"runId",
			"adapterInputId",
			"requestId",
			"operationId",
			"routeId",
			"executorId",
			"profileId",
			"runAdmissionId",
			"attempt",
			"environmentId",
			"environmentRevision",
			"manifestFingerprint",
			"epoch",
		]) ||
		!positive(raw.attempt)
	)
		return undefined;
	try {
		for (const value of [
			raw.cancellationId,
			raw.runId,
			raw.adapterInputId,
			raw.requestId,
			raw.operationId,
			raw.routeId,
			raw.executorId,
			raw.profileId,
			raw.runAdmissionId,
			raw.environmentId,
			raw.environmentRevision,
			raw.manifestFingerprint,
			raw.epoch,
		]) {
			if (typeof value !== "string") return undefined;
			assertSafe(value, "cancellation coordinate");
		}
		return Object.freeze({
			kind: "managed-untrusted-js-compute-cancellation-requested",
			cancellationId: raw.cancellationId as string,
			runId: raw.runId as string,
			adapterInputId: raw.adapterInputId as string,
			requestId: raw.requestId as string,
			operationId: raw.operationId as string,
			routeId: raw.routeId as string,
			executorId: raw.executorId as string,
			profileId: raw.profileId as string,
			runAdmissionId: raw.runAdmissionId as string,
			attempt: raw.attempt as number,
			environmentId: raw.environmentId as string,
			environmentRevision: raw.environmentRevision as string,
			manifestFingerprint: raw.manifestFingerprint as string,
			epoch: raw.epoch as string,
		});
	} catch {
		return undefined;
	}
}

function snapshotCancellationDecision(
	raw: unknown,
): ManagedUntrustedJsComputeCancellationDecision | undefined {
	if (
		!plain(raw) ||
		hasAccessorOrExoticObject(raw) ||
		raw.kind !== "managed-untrusted-js-compute-cancellation-decision" ||
		!exactKeys(raw, [
			"kind",
			"decisionId",
			"proposalId",
			"outcome",
			"sourceRefs",
			"cancellationId",
			"runId",
			"adapterInputId",
			"requestId",
			"operationId",
			"routeId",
			"executorId",
			"profileId",
			"runAdmissionId",
			"attempt",
			"environmentId",
			"environmentRevision",
			"manifestFingerprint",
			"epoch",
		]) ||
		(raw.outcome !== "admit" && raw.outcome !== "block")
	)
		return undefined;
	try {
		if (typeof raw.decisionId !== "string" || typeof raw.proposalId !== "string") return undefined;
		assertSafe(raw.decisionId, "cancellation decision");
		if (!generatedCancellationIdentity(raw.proposalId)) return undefined;
		const sourceRefs = refs(raw.sourceRefs as SourceRef[]);
		if (sourceRefs.length !== 1 || sourceRefs[0]?.kind !== "authorization") return undefined;
		const request = snapshotCancellation({
			kind: "managed-untrusted-js-compute-cancellation-requested",
			cancellationId: raw.cancellationId,
			runId: raw.runId,
			adapterInputId: raw.adapterInputId,
			requestId: raw.requestId,
			operationId: raw.operationId,
			routeId: raw.routeId,
			executorId: raw.executorId,
			profileId: raw.profileId,
			runAdmissionId: raw.runAdmissionId,
			attempt: raw.attempt,
			environmentId: raw.environmentId,
			environmentRevision: raw.environmentRevision,
			manifestFingerprint: raw.manifestFingerprint,
			epoch: raw.epoch,
		});
		if (request === undefined) return undefined;
		return Object.freeze({
			...request,
			kind: "managed-untrusted-js-compute-cancellation-decision",
			decisionId: raw.decisionId,
			proposalId: raw.proposalId,
			outcome: raw.outcome,
			sourceRefs,
		});
	} catch {
		return undefined;
	}
}

function cancellationCoordinatesMatch(
	left: Omit<ManagedUntrustedJsComputeCancellationRequested, "kind">,
	right: Omit<ManagedUntrustedJsComputeCancellationRequested, "kind">,
): boolean {
	return (
		left.cancellationId === right.cancellationId &&
		left.runId === right.runId &&
		left.adapterInputId === right.adapterInputId &&
		left.requestId === right.requestId &&
		left.operationId === right.operationId &&
		left.routeId === right.routeId &&
		left.executorId === right.executorId &&
		left.profileId === right.profileId &&
		left.runAdmissionId === right.runAdmissionId &&
		left.attempt === right.attempt &&
		left.environmentId === right.environmentId &&
		left.environmentRevision === right.environmentRevision &&
		left.manifestFingerprint === right.manifestFingerprint &&
		left.epoch === right.epoch
	);
}

function cancellationMatchesRecord(
	request: Omit<ManagedUntrustedJsComputeCancellationRequested, "kind">,
	record: Active,
): boolean {
	const metadata = record.request.metadata as
		| Partial<ExecutionEnvironmentPinnedRunMetadata>
		| undefined;
	return (
		request.runId === record.request.runId &&
		request.adapterInputId === record.request.adapterInputId &&
		request.requestId === record.request.requestId &&
		request.operationId === record.request.operationId &&
		request.routeId === record.request.routeId &&
		request.executorId === record.request.executorId &&
		request.profileId === record.request.profileId &&
		request.runAdmissionId === record.runAdmissionId &&
		request.attempt === record.request.attempt &&
		request.environmentId === metadata?.executionEnvironmentId &&
		request.environmentRevision === record.context.environmentRevision &&
		request.manifestFingerprint === record.context.manifestFingerprint &&
		request.epoch === record.context.epoch
	);
}

function snapshotDriverResult(
	raw: ManagedUntrustedJsComputeDriverResult,
	record: Active,
): ManagedUntrustedJsComputeDriverResult {
	if (!plain(raw)) throw new TypeError("Invalid managed untrusted JS compute result.");
	const movementFacts =
		raw.movement === undefined
			? undefined
			: raw.movement.map((fact) => snapshotMovement(fact, record));
	if (movementFacts !== undefined && movementFacts.length > MAX_MOVEMENT)
		throw new TypeError("Too much managed untrusted JS compute movement evidence.");
	if (raw.outcome === "succeeded") {
		const resultRefs = refs(raw.resultRefs);
		if (!provesResultMovement(resultRefs, movementFacts))
			throw new TypeError("Managed untrusted JS compute result movement evidence is missing.");
		return Object.freeze({
			outcome: "succeeded",
			resultRefs,
			...(raw.artifactRefs === undefined ? {} : { artifactRefs: refs(raw.artifactRefs) }),
			...(raw.usage === undefined ? {} : { usage: usage(raw.usage) }),
			...(movementFacts === undefined ? {} : { movement: movementFacts }),
		});
	}
	if (raw.outcome === "failed" || raw.outcome === "timeout")
		return Object.freeze({
			outcome: raw.outcome,
			issue: issue(raw.issue, `managed-untrusted-js-compute-${raw.outcome}`),
			...(raw.artifactRefs === undefined ? {} : { artifactRefs: refs(raw.artifactRefs) }),
			...(raw.usage === undefined ? {} : { usage: usage(raw.usage) }),
			...(movementFacts === undefined ? {} : { movement: movementFacts }),
		});
	if (raw.outcome === "canceled")
		return Object.freeze({
			outcome: "canceled",
			...(raw.reason === undefined
				? {}
				: { reason: publicText(raw.reason, "managed-untrusted-js-compute-canceled") }),
			...(raw.artifactRefs === undefined ? {} : { artifactRefs: refs(raw.artifactRefs) }),
			...(raw.usage === undefined ? {} : { usage: usage(raw.usage) }),
			...(movementFacts === undefined ? {} : { movement: movementFacts }),
		});
	throw new TypeError("Invalid managed untrusted JS compute result.");
}

function snapshotMovement(
	raw: ManagedUntrustedJsComputeMovementEvidence,
	record: Active,
): ManagedUntrustedJsComputeMovementEvidence {
	if (
		!plain(raw) ||
		raw.kind !== "managed-untrusted-js-compute-movement-evidence" ||
		raw.runId !== record.request.runId ||
		raw.attempt !== record.request.attempt ||
		raw.epoch !== record.context.epoch ||
		!["host-to-sandbox", "sandbox-to-host"].includes(raw.direction) ||
		!["bundle", "input-artifact", "result-artifact", "bounded-log-ref"].includes(
			raw.classification,
		) ||
		!Number.isSafeInteger(raw.bytes) ||
		raw.bytes < 0 ||
		raw.bytes > MAX_MOVEMENT_BYTES ||
		typeof raw.truncated !== "boolean"
	)
		throw new TypeError("Invalid managed untrusted JS compute movement evidence.");
	return Object.freeze({
		...raw,
		...(raw.artifactRefs === undefined ? {} : { artifactRefs: refs(raw.artifactRefs) }),
	});
}

function provesResultMovement(
	resultRefs: readonly SourceRef[],
	movementFacts: readonly ManagedUntrustedJsComputeMovementEvidence[] | undefined,
): boolean {
	if (resultRefs.length === 0 || movementFacts === undefined || movementFacts.length === 0)
		return false;
	const movedResultRefs = new Set(
		movementFacts
			.filter(
				(fact) => fact.direction === "sandbox-to-host" && fact.classification === "result-artifact",
			)
			.flatMap((fact) => fact.artifactRefs ?? [])
			.map((ref) => `${ref.kind}:${ref.id}`),
	);
	return resultRefs.every((ref) => movedResultRefs.has(`${ref.kind}:${ref.id}`));
}

function outcome(record: Active, result: ManagedUntrustedJsComputeDriverResult): ExecutorOutcome {
	const cancellationRefs =
		result.outcome === "canceled" && record.acceptedCancellation !== undefined
			? [
					{
						kind: "managed-untrusted-js-compute-cancellation",
						id: record.acceptedCancellation.cancellationId,
					},
					{
						kind: "managed-untrusted-js-compute-cancellation-proposal",
						id: record.acceptedCancellation.proposalId,
					},
					{
						kind: "managed-untrusted-js-compute-cancellation-decision",
						id: record.acceptedCancellation.decisionId,
					},
					{
						kind: "managed-untrusted-js-compute-cancellation-admission",
						id: record.acceptedCancellation.admissionId,
					},
					...record.acceptedCancellation.sourceRefs,
				]
			: [];
	const evidenceRefs = [
		{ kind: "managed-untrusted-js-compute-run", id: record.request.runId },
		...cancellationRefs,
		...(result.outcome === "succeeded"
			? result.resultRefs
			: "artifactRefs" in result && result.artifactRefs !== undefined
				? result.artifactRefs
				: []),
	];
	const output: AgentOutputEnvelope<{ readonly kind: "managed-untrusted-js-compute-result-refs" }> =
		{
			kind: "managed-untrusted-js-compute-result",
			value: { kind: "managed-untrusted-js-compute-result-refs" },
			refs: result.outcome === "succeeded" ? result.resultRefs : [],
			metadata: {
				outputId: compoundTupleKey("managed-untrusted-js-compute-output", [
					record.request.runId,
					String(record.request.attempt),
				]),
			},
		};
	if (result.outcome === "succeeded")
		return buildToolProviderExecutorOutcome(
			record.input,
			{
				kind: "result",
				result: output,
				evidenceRefs,
				usage: result.usage,
				metadata: {
					runId: record.request.runId,
					epoch: record.context.epoch,
					manifestFingerprint: record.context.manifestFingerprint,
				},
			},
			{ runId: record.request.runId, attempt: record.request.attempt },
		);
	if (result.outcome === "failed" || result.outcome === "timeout")
		return result.outcome === "timeout"
			? buildToolProviderExecutorOutcome(
					record.input,
					{
						kind: "timeout",
						evidenceRefs,
						issues: [result.issue],
						usage: result.usage,
						metadata: {
							runId: record.request.runId,
							epoch: record.context.epoch,
							manifestFingerprint: record.context.manifestFingerprint,
						},
					},
					{ runId: record.request.runId, attempt: record.request.attempt },
				)
			: buildToolProviderExecutorOutcome(
					record.input,
					{
						kind: "failure",
						error: result.issue,
						evidenceRefs,
						usage: result.usage,
						metadata: {
							runId: record.request.runId,
							epoch: record.context.epoch,
							manifestFingerprint: record.context.manifestFingerprint,
						},
					},
					{ runId: record.request.runId, attempt: record.request.attempt },
				);
	if (result.outcome !== "canceled") throw new TypeError("Invalid managed untrusted JS outcome.");
	return buildToolProviderExecutorOutcome(
		record.input,
		{
			kind: "canceled",
			reason: result.reason ?? "managed-untrusted-js-compute-canceled",
			evidenceRefs,
			usage: result.usage,
			metadata: {
				runId: record.request.runId,
				epoch: record.context.epoch,
				manifestFingerprint: record.context.manifestFingerprint,
				...(record.acceptedCancellation === undefined
					? {}
					: {
							cancellationId: record.acceptedCancellation.cancellationId,
							cancellationProposalId: record.acceptedCancellation.proposalId,
							cancellationDecisionId: record.acceptedCancellation.decisionId,
							cancellationAdmissionId: record.acceptedCancellation.admissionId,
						}),
			},
		},
		{ runId: record.request.runId, attempt: record.request.attempt },
	);
}

function status(
	request: ToolProviderAdapterRunRequested,
	status: ToolProviderAdapterRunStatus["status"],
	code?: string,
): ToolProviderAdapterRunStatus {
	return {
		kind: "tool-provider-adapter-run-status",
		runId: request.runId,
		adapterInputId: request.adapterInputId,
		requestId: request.requestId,
		operationId: request.operationId,
		attempt: request.attempt,
		status,
		...(code === undefined
			? {}
			: { issues: [{ kind: "issue" as const, code, message: code, severity: "error" as const }] }),
		metadata: {
			...(request.routeId === undefined ? {} : { routeId: request.routeId }),
			...(request.profileId === undefined ? {} : { profileId: request.profileId }),
		},
	};
}

function activeKey(value: { readonly runId: string; readonly attempt: number }) {
	return `${value.runId}:${value.attempt}`;
}

function outcomeStatus(result: ManagedUntrustedJsComputeDriverResult): ExecutorOutcome["kind"] {
	if (result.outcome === "succeeded") return "result";
	if (result.outcome === "failed") return "failure";
	return result.outcome;
}

function issue(raw: DataIssue, fallbackCode: string): DataIssue {
	const code = plain(raw) ? publicText(raw.code, fallbackCode) : fallbackCode;
	const severity =
		plain(raw) && ["info", "warning", "error"].includes(String(raw.severity))
			? (raw.severity as DataIssue["severity"])
			: "error";
	const refs = plain(raw) ? issueRefs(raw.refs) : undefined;
	return Object.freeze({
		kind: "issue",
		code,
		message: "Managed untrusted JS compute driver reported a bounded outcome issue.",
		severity,
		...(refs === undefined || refs.length === 0 ? {} : { refs }),
		...(plain(raw) && typeof raw.retryable === "boolean" ? { retryable: raw.retryable } : {}),
	});
}

function issueRefs(raw: unknown): readonly string[] | undefined {
	if (raw === undefined) return undefined;
	if (!Array.isArray(raw) || raw.length > MAX_REFS)
		throw new TypeError("Invalid compute issue refs.");
	const result: string[] = [];
	for (const item of raw) {
		if (typeof item !== "string" || !REF_ID_SAFE.test(item) || privateText(item))
			throw new TypeError("Compute issue ref contains private material.");
		result.push(item);
	}
	return Object.freeze([...new Set(result)]);
}

function usage(raw: ExecutorUsage): ExecutorUsage {
	if (!plain(raw)) throw new TypeError("Invalid compute usage.");
	const source = raw as Record<string, unknown>;
	if (
		!exactKeysOptional(
			source,
			[],
			[
				"inputTokens",
				"outputTokens",
				"cacheHitTokens",
				"cacheMissTokens",
				"cacheWriteTokens",
				"cacheMode",
				"costUsd",
				"latencyMs",
			],
		)
	)
		throw new TypeError("Invalid compute usage.");
	const result: Record<string, number | string> = {};
	for (const key of [
		"inputTokens",
		"outputTokens",
		"cacheHitTokens",
		"cacheMissTokens",
		"cacheWriteTokens",
		"costUsd",
		"latencyMs",
	] as const) {
		const value = source[key];
		if (value === undefined) continue;
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
			throw new TypeError("Invalid compute usage.");
		result[key] = value;
	}
	if (source.cacheMode !== undefined) result.cacheMode = publicText(source.cacheMode, "bounded");
	return Object.freeze(result as ExecutorUsage);
}

function publicText(value: unknown, fallback: string): string {
	if (typeof value !== "string" || !REF_ID_SAFE.test(value) || privateText(value)) return fallback;
	return value;
}

function generatedCancellationIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_GENERATED_CANCELLATION_ID_CHARS &&
		/^[\x20-\x7e]+$/.test(value)
	);
}

function privateText(value: string): boolean {
	const text = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
	return PRIVATE_REF_TERMS.some((term) => text.includes(term));
}

function refIds(raw: readonly SourceRef[] | undefined): readonly string[] {
	return refs(raw).map((ref) => `${ref.kind}:${ref.id}`);
}

function refs(raw: readonly SourceRef[] | undefined): readonly SourceRef[] {
	if (
		!Array.isArray(raw) ||
		raw.length > MAX_REFS ||
		raw.some(
			(ref) =>
				!plain(ref) ||
				hasAccessorOrExoticObject(ref) ||
				!exactKeys(ref, ["kind", "id"]) ||
				typeof ref.kind !== "string" ||
				typeof ref.id !== "string" ||
				!SAFE.test(ref.kind) ||
				!REF_ID_SAFE.test(ref.id),
		)
	)
		throw new TypeError("Invalid managed untrusted JS compute refs.");
	for (const ref of raw) {
		if (privateText(`${ref.kind}:${ref.id}`))
			throw new TypeError("Managed untrusted JS compute ref contains private material.");
	}
	return Object.freeze(raw.map((ref) => Object.freeze({ kind: ref.kind, id: ref.id })));
}

function assertSafe(value: string, name: string) {
	if (!SAFE.test(value) || privateText(value)) throw new TypeError(`Invalid ${name}.`);
}

function positive(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function plain(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
	);
}

function hasAccessorOrExoticObject(value: unknown, seen = new Set<object>()): boolean {
	if (value === null || typeof value !== "object") return false;
	if (seen.has(value)) return false;
	seen.add(value);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
		return true;
	for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
		if (descriptor.get !== undefined || descriptor.set !== undefined) return true;
		if ("value" in descriptor && hasAccessorOrExoticObject(descriptor.value, seen)) return true;
	}
	return false;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactKeysOptional(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[],
) {
	const allowed = new Set([...required, ...optional]);
	const keys = Object.keys(value);
	return required.every((key) => key in value) && keys.every((key) => allowed.has(key));
}
