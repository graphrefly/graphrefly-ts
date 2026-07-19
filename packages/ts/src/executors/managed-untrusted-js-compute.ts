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
	"graphrefly-managed-untrusted-js-compute-v1" as const;
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
	readonly attempt: number;
	readonly environmentRevision: string;
	readonly manifestFingerprint: string;
	readonly epoch: string;
}

export interface ManagedUntrustedJsComputeCancellationAcknowledgement {
	readonly kind: "managed-untrusted-js-compute-cancellation-acknowledgement";
	readonly cancellationId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly epoch: string;
	readonly state: "kill-requested" | "rejected";
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
	 * Fences every in-flight createSandbox call. Once this settles, an unresolved createSandbox
	 * must not later expose a live sandbox; the driver owns provider cleanup for that allocation.
	 */
	close?(): void | PromiseLike<void>;
}

export interface ManagedUntrustedJsComputeRuntimeOptions {
	readonly name?: string;
	readonly inputs: Node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>;
	readonly admittedRunRequests: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly manifests: readonly Node<ManagedUntrustedJsComputeManifest>[];
	readonly readiness: readonly Node<ManagedUntrustedJsComputeReadiness>[];
	readonly cancellationRequests?: readonly Node<ManagedUntrustedJsComputeCancellationRequested>[];
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
	readonly cancellations: Node<ManagedUntrustedJsComputeCancellationAcknowledgement>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	dispose(): Promise<void>;
}

interface Active {
	readonly input: ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>;
	readonly request: ToolProviderAdapterRunRequested;
	readonly manifest: ManagedUntrustedJsComputeManifest;
	readonly context: ManagedUntrustedJsComputeDriverContext;
	readonly abortController: AbortController;
	readonly disposeSignal: Promise<"disposed">;
	readonly resolveDispose: () => void;
	sandbox?: unknown;
	cancelRequested: boolean;
	cancelled: boolean;
	settled: boolean;
	destroyed: boolean;
	cleanupPublished: boolean;
	destroyingPublished: boolean;
	publishCleanupRequested: boolean;
	killRequired: boolean;
	allocationPromise?: Promise<void>;
	allocationSettled: boolean;
	allocationFenced: boolean;
	killPromise?: Promise<boolean>;
	killCompletion?: Promise<boolean>;
	killState?: boolean;
	destroyPromise?: Promise<void>;
	postKillDestroyScheduled: boolean;
	destroyState?: ManagedUntrustedJsComputeCleanupStatus["state"];
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const REF_ID_SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-[\]",]{0,511}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_REFS = 32;
const MAX_MOVEMENT = 16;
const MAX_MOVEMENT_BYTES = 64 * 1024 * 1024;
const DISPOSE_DRAIN_TIMEOUT_MS = 100;
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
			"attestationRefs",
		]) ||
		value.compatibilityRevision !== MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY ||
		value.backend !== MANAGED_UNTRUSTED_JS_COMPUTE_BACKEND ||
		value.networkPolicyRevision !== "deny-all-external-v1" ||
		!positive(value.executionTimeoutMs) ||
		!positive(value.killGraceMs)
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
	const terminal = new Set<string>();
	const pending = new Set<Promise<unknown>>();
	let disposed = false;
	let disposePromise: Promise<void> | undefined;
	let disposeComplete = false;
	let releasePending = true;
	const now = opts.now ?? Date.now;
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
	) => {
		const fact: ManagedUntrustedJsComputeLifecycleFact = Object.freeze({
			kind: "managed-untrusted-js-compute-lifecycle-fact",
			state,
			runId: record.request.runId,
			attempt: record.request.attempt,
			environmentRevision: record.context.environmentRevision,
			manifestFingerprint: record.context.manifestFingerprint,
			epoch: record.context.epoch,
			occurredAtMs: now(),
			...(evidenceRefs === undefined ? {} : { evidenceRefs: refs(evidenceRefs) }),
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
		});
	};
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
					emit(admittedRunRequests, request);
					emit(runStatus, status(request, "requested"));
					emitLifecycle("admitted", activeRecord, request.sourceRefs);
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
					record.context.epoch !== request.epoch ||
					record.context.environmentRevision !== request.environmentRevision ||
					record.context.manifestFingerprint !== request.manifestFingerprint ||
					record.settled ||
					record.cancelRequested ||
					record.sandbox === undefined
				) {
					emit(cancellations, {
						kind: "managed-untrusted-js-compute-cancellation-acknowledgement",
						cancellationId: request.cancellationId,
						runId: request.runId,
						attempt: request.attempt,
						epoch: request.epoch,
						state: "rejected",
						code: "not-current",
					});
					return;
				}
				record.cancelRequested = true;
				record.killRequired = true;
				emitLifecycle("cancel-requested", record);
				record.abortController.abort();
				track(
					(async () => {
						emitLifecycle("kill-requested", record);
						const delivered = await killOnce(record);
						if (disposed) return;
						if (delivered) {
							emit(cancellations, {
								kind: "managed-untrusted-js-compute-cancellation-acknowledgement",
								cancellationId: request.cancellationId,
								runId: request.runId,
								attempt: request.attempt,
								epoch: request.epoch,
								state: "kill-requested",
							});
						} else {
							issue(
								"managed-untrusted-js-compute-cancellation-kill-failed",
								"Managed untrusted JS compute cancellation kill was not delivered.",
							);
							emit(cancellations, {
								kind: "managed-untrusted-js-compute-cancellation-acknowledgement",
								cancellationId: request.cancellationId,
								runId: request.runId,
								attempt: request.attempt,
								epoch: request.epoch,
								state: "rejected",
								code: "kill-failed",
							});
						}
					})(),
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
				record.killRequired = true;
				if (record.sandbox !== undefined) void killOnce(record);
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
			const result = await Promise.race([driverWork, timeoutSignal, record.disposeSignal]);
			if (result === "disposed") return;
			if (disposed) return;
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
			const problem = {
				code: record.cancelled
					? "managed-untrusted-js-compute-canceled"
					: "managed-untrusted-js-compute-failed",
				message: record.cancelled
					? "Managed untrusted JS compute was cancelled."
					: "Managed untrusted JS compute failed closed.",
				severity: "error" as const,
			};
			record.settled = true;
			emit(
				outcomes,
				outcome(record, {
					outcome: record.cancelled ? "canceled" : "failed",
					...(record.cancelled
						? { reason: "managed-untrusted-js-compute-canceled" }
						: { issue: problem }),
				} as ManagedUntrustedJsComputeDriverResult),
			);
			emit(runStatus, status(record.request, record.cancelled ? "canceled" : "failure"));
			if (!record.cancelled) issue(problem.code, problem.message);
			void caught;
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
			await destroy(record, !disposed);
			if (!disposed) emitLifecycle("settled", record);
			const key = activeKey(record.request);
			active.delete(key);
			terminal.add(key);
		}
	};
	const boundedProviderWork = <T>(
		work: Promise<T>,
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
			const timeout = setTimeout(() => finish({ state: "timeout" }), DISPOSE_DRAIN_TIMEOUT_MS);
			void work.then(
				(value) => finish({ state: "fulfilled", value }),
				() => finish({ state: "rejected" }),
			);
		});
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
			const result = await boundedProviderWork(record.killCompletion as Promise<boolean>);
			record.killState = result.state === "fulfilled" && result.value;
			if (record.killState) record.cancelled = record.cancelRequested;
			return record.killState;
		})();
		return record.killPromise;
	};
	const startDestroy = async (record: Active) => {
		if (record.destroyPromise === undefined) {
			record.destroyed = true;
			record.destroyPromise = (async () => {
				if (record.publishCleanupRequested && releasePending) publishDestroying(record);
				const result = await boundedProviderWork(
					Promise.resolve().then(() => opts.driver.destroy(record.sandbox, record.context)),
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
			if (record.publishCleanupRequested) publishCleanup(record, "unverifiable");
			return;
		}
		if (record.killPromise !== undefined) await record.killPromise;
		if (record.killRequired && record.killState === false && record.killCompletion !== undefined) {
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
		cancellations,
		issues,
		audit,
		dispose() {
			if (disposePromise === undefined) {
				disposed = true;
				disposePromise = Promise.resolve()
					.then(async () => {
						for (const unsubscribe of unsubscribes) unsubscribe();
						const records = new Set([...active.values(), ...allocating]);
						for (const record of records) {
							if (!record.settled || allocating.has(record)) {
								record.killRequired = true;
								record.cancelled = true;
								if (record.sandbox !== undefined) void killOnce(record);
								record.resolveDispose();
								record.abortController.abort();
							}
						}
						const allocationWork = [...records]
							.map((record) => record.allocationPromise)
							.filter((work): work is Promise<void> => work !== undefined);
						await Promise.race([
							Promise.allSettled(allocationWork),
							new Promise<void>((resolve) => setTimeout(resolve, DISPOSE_DRAIN_TIMEOUT_MS)),
						]);
						const unresolvedAllocations = [...records].filter(
							(record) => record.allocationPromise !== undefined && !record.allocationSettled,
						);
						for (const record of records) {
							if (record.killRequired && record.sandbox !== undefined) void killOnce(record);
							if (record.killPromise !== undefined) await record.killPromise;
							await destroy(record).catch(() => undefined);
						}
						const closeResult =
							opts.driver.close === undefined
								? undefined
								: await boundedProviderWork(Promise.resolve().then(() => opts.driver.close?.()));
						if (unresolvedAllocations.length > 0 && closeResult?.state === "fulfilled")
							for (const record of unresolvedAllocations) record.allocationFenced = true;
						if (unresolvedAllocations.length > 0 && closeResult?.state !== "fulfilled")
							issue(
								"managed-untrusted-js-compute-allocation-fence-unavailable",
								"Managed untrusted JS compute allocation could not be fenced before disposal.",
							);
						if (closeResult !== undefined && closeResult.state !== "fulfilled")
							issue(
								"managed-untrusted-js-compute-driver-close-unverifiable",
								"Managed untrusted JS compute driver close did not settle successfully.",
							);
						await Promise.race([
							Promise.allSettled([...pending]),
							new Promise<void>((resolve) => setTimeout(resolve, DISPOSE_DRAIN_TIMEOUT_MS)),
						]);
						active.clear();
						allocating.clear();
						terminal.clear();
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
		(input.routeId !== undefined && input.routeId !== request.routeId) ||
		(input.executorId !== undefined && input.executorId !== request.executorId) ||
		(input.profileId !== undefined && input.profileId !== request.profileId)
	)
		return failure("mismatched-request", "managed-untrusted-js-compute-request-mismatch", request);
	const meta = request.metadata as Partial<ExecutionEnvironmentPinnedRunMetadata> | undefined;
	if (
		meta?.executionEnvironmentLocality !== "managed-cloud" ||
		meta.executionEnvironmentBindingKind !== "remote-session" ||
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
	return {
		input,
		request,
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
		cancelRequested: false,
		cancelled: false,
		settled: false,
		destroyed: false,
		cleanupPublished: false,
		destroyingPublished: false,
		publishCleanupRequested: false,
		killRequired: false,
		allocationSettled: false,
		allocationFenced: false,
		postKillDestroyScheduled: false,
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
		raw.kind !== "managed-untrusted-js-compute-cancellation-requested" ||
		!exactKeys(raw, [
			"kind",
			"cancellationId",
			"runId",
			"attempt",
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
			attempt: raw.attempt as number,
			environmentRevision: raw.environmentRevision as string,
			manifestFingerprint: raw.manifestFingerprint as string,
			epoch: raw.epoch as string,
		});
	} catch {
		return undefined;
	}
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
	const evidenceRefs = [
		{ kind: "managed-untrusted-js-compute-run", id: record.request.runId },
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
