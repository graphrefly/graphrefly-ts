/** D667 focused local untrusted-JavaScript compute contract. */
import type { DataIssue } from "../data/index.js";
import {
	type DescribeSnapshot,
	type GraphTopologySnapshot,
	topologyFromDescribe,
} from "../graph/describe.js";
import type { Graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";
import type { Node } from "../node/node.js";
import type {
	AgentRuntimeAuditRecord,
	ExecutorOutcome,
	ExecutorUsage,
	SourceRef,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunStatus,
	ToolProviderRunAdmission,
} from "../orchestration/index.js";
import { buildToolProviderExecutorOutcome } from "../orchestration/index.js";

export const LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY =
	"graphrefly-local-untrusted-js-compute-v1" as const;
export const LOCAL_UNTRUSTED_JS_COMPUTE_BACKEND =
	"local-untrusted-js-compute-podman-libpod-api-v0-rootless" as const;
export const LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API = "graphrefly-runner-api-v1" as const;
const MAX_EXECUTION_TIMEOUT_MS = 5 * 60_000;
const MAX_KILL_GRACE_MS = 60_000;
const MAX_CLEANUP_TIMEOUT_MS = 5 * 60_000;
const MAX_MATERIAL_BYTES = 16 * 1024 * 1024;
const MAX_TOPOLOGY_NODES = 100_000;
const MAX_TOPOLOGY_EDGES = 200_000;

export type LocalUntrustedJsJson =
	| null
	| boolean
	| number
	| string
	| readonly LocalUntrustedJsJson[]
	| { readonly [key: string]: LocalUntrustedJsJson };

export interface LocalUntrustedJsComputeManifest {
	readonly kind: "local-untrusted-js-compute-manifest";
	readonly manifestId: string;
	readonly revision: string;
	readonly fingerprint: string;
	readonly compatibilityRevision: typeof LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY;
	readonly backend: typeof LOCAL_UNTRUSTED_JS_COMPUTE_BACKEND;
	readonly runnerApiRevision: typeof LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API;
	readonly runnerImageDigest: string;
	readonly runnerRevision: string;
	readonly compilerRevision: string;
	readonly allowedApiRevision: string;
	readonly graphreflyPackageRevision: string;
	readonly sandboxPolicyRevision: string;
	readonly networkPolicyRevision: "deny-all-v1";
	readonly filesystemPolicyRevision: "read-only-input-bounded-tmp-v1";
	readonly resourcePolicyRevision: string;
	readonly outputPolicyRevision: string;
	readonly executionTimeoutMs: number;
	readonly killGraceMs: number;
	readonly cleanupTimeoutMs: number;
	readonly maxBundleBytes: number;
	readonly maxInputBytes: number;
	readonly maxOutputBytes: number;
	readonly maxTopologyNodes: number;
	readonly maxTopologyEdges: number;
}

export interface LocalUntrustedJsComputeReadiness {
	readonly kind: "local-untrusted-js-compute-readiness";
	readonly manifestFingerprint: string;
	readonly state: "ready" | "stale" | "unavailable";
	readonly observedAtMs: number;
	readonly expiresAtMs: number;
	readonly rootlessVerified: boolean;
	readonly imageDigestVerified: boolean;
	readonly runnerVerified: boolean;
	readonly nonRootVerified: boolean;
	readonly readOnlyRootFilesystemVerified: boolean;
	readonly noNewPrivilegesVerified: boolean;
	readonly capabilitiesDroppedVerified: boolean;
	readonly noEngineSocketMountVerified: boolean;
	readonly noHostBindMountVerified: boolean;
	readonly denyNetworkVerified: boolean;
	readonly resourceBoundsVerified: boolean;
	readonly cancellationVerified: boolean;
	readonly cleanupVerified: boolean;
	readonly hostBindingDigest: string;
	readonly attestationRefs: readonly string[];
}

export interface LocalUntrustedJsComputeArguments {
	readonly contractVersion: "1";
	readonly runId: string;
	readonly attempt: number;
	readonly epoch: string;
	readonly sourceRevision: string;
	readonly sourceDigest: string;
	readonly bundleRevision: string;
	readonly bundleDigest: string;
	readonly compilerRevision: string;
	readonly allowedApiRevision: string;
	readonly graphreflyPackageRevision: string;
	readonly runnerRevision: string;
	readonly runnerImageDigest: string;
	readonly sandboxPolicyRevision: string;
	readonly networkPolicyRevision: "deny-all-v1";
	readonly filesystemPolicyRevision: "read-only-input-bounded-tmp-v1";
	readonly resourcePolicyRevision: string;
	readonly outputPolicyRevision: string;
	readonly admittedInputRefs: readonly string[];
	readonly inputDigest: string;
}

export interface LocalUntrustedJsComputeMaterial {
	readonly bundle: Uint8Array;
	readonly input: LocalUntrustedJsJson;
}

export interface LocalUntrustedJsComputeProvenance {
	readonly sourceRevision: string;
	readonly sourceDigest: string;
	readonly bundleRevision: string;
	readonly bundleDigest: string;
	readonly compilerRevision: string;
	readonly allowedApiRevision: string;
	readonly graphreflyPackageRevision: string;
	readonly runnerRevision: string;
	readonly runnerImageDigest: string;
	readonly manifestFingerprint: string;
	readonly runId: string;
	readonly attempt: number;
	readonly graphName: string;
	readonly admittedInputRefs: readonly string[];
	readonly inputDigest: string;
	readonly runAdmissionId: string;
}

export interface LocalUntrustedJsComputeRunnerResult {
	readonly contractVersion: "1";
	readonly answer: LocalUntrustedJsJson;
	readonly topology: GraphTopologySnapshot;
	readonly describe: DescribeSnapshot;
	readonly provenance: LocalUntrustedJsComputeProvenance;
	readonly cleanup: {
		readonly graphNodesAfterDispose: 0;
		readonly graphEdgesAfterDispose: 0;
	};
}

export interface LocalUntrustedJsComputeRunnerControl {
	readonly contractVersion: "1";
	readonly compatibilityRevision: typeof LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY;
	readonly runnerApiRevision: typeof LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API;
	readonly manifestFingerprint: string;
	readonly args: LocalUntrustedJsComputeArguments;
	readonly runAdmissionId: string;
}

export type LocalUntrustedJsComputeCleanupState = "succeeded" | "failed" | "unverifiable";

export type LocalUntrustedJsComputeDriverOutcome =
	| {
			readonly outcome: "succeeded";
			readonly result: LocalUntrustedJsComputeRunnerResult;
			readonly cleanup: LocalUntrustedJsComputeCleanupState;
	  }
	| {
			readonly outcome: "failed" | "timeout" | "canceled";
			readonly code: string;
			readonly cleanup: LocalUntrustedJsComputeCleanupState;
	  };

export interface LocalUntrustedJsComputeDriverContext {
	readonly runId: string;
	readonly attempt: number;
	readonly epoch: string;
	readonly manifestFingerprint: string;
	readonly hostBindingDigest: string;
	readonly runAdmissionId: string;
	readonly signal: AbortSignal;
}

/**
 * Runtime sockets, endpoints, container ids, paths and private handles stay behind this driver.
 * The driver owns fresh allocation, bounded transfer, execution, cancellation and exact cleanup.
 */
export interface LocalUntrustedJsComputeDriver {
	readonly compatibility: typeof LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY;
	execute(
		context: LocalUntrustedJsComputeDriverContext,
		args: LocalUntrustedJsComputeArguments,
		material: LocalUntrustedJsComputeMaterial,
		manifest: LocalUntrustedJsComputeManifest,
	): LocalUntrustedJsComputeDriverOutcome | PromiseLike<LocalUntrustedJsComputeDriverOutcome>;
}

export interface RunLocalUntrustedJsComputeAttemptOptions {
	readonly manifest: LocalUntrustedJsComputeManifest;
	readonly readiness: LocalUntrustedJsComputeReadiness;
	readonly args: LocalUntrustedJsComputeArguments;
	readonly material: LocalUntrustedJsComputeMaterial;
	readonly adapterInput: ToolProviderAdapterInput<LocalUntrustedJsComputeArguments>;
	readonly admittedRunRequest: ToolProviderAdapterRunRequested;
	readonly runAdmission: ToolProviderRunAdmission;
	readonly driver: LocalUntrustedJsComputeDriver;
	readonly signal: AbortSignal;
	readonly now?: () => number;
}

export type LocalUntrustedJsComputeLifecycleState =
	| "admitted"
	| "loading-material"
	| "running"
	| "cleaning"
	| "settled";

export interface LocalUntrustedJsComputeLifecycleFact {
	readonly kind: "local-untrusted-js-compute-lifecycle-fact";
	readonly state: LocalUntrustedJsComputeLifecycleState;
	readonly runId: string;
	readonly attempt: number;
	readonly epoch: string;
	readonly manifestFingerprint: string;
	readonly runAdmissionId: string;
	readonly occurredAtMs: number;
	readonly sourceRefs?: readonly SourceRef[];
}

export interface LocalUntrustedJsComputeCleanupStatus {
	readonly kind: "local-untrusted-js-compute-cleanup-status";
	readonly runId: string;
	readonly attempt: number;
	readonly epoch: string;
	readonly state: LocalUntrustedJsComputeCleanupState;
	readonly issue?: DataIssue;
}

export interface LocalUntrustedJsComputeUsageFact extends ExecutorUsage {
	readonly kind: "local-untrusted-js-compute-usage";
	readonly runId: string;
	readonly attempt: number;
}

/**
 * Graph-visible cancellation authority for one exact D667 attempt. Producing a request alone
 * never aborts compute; only an independently admitted fact reaches the host-private driver.
 */
export interface LocalUntrustedJsComputeCancellationAdmission {
	readonly kind: "local-untrusted-js-compute-cancellation-admission";
	readonly admissionId: string;
	readonly cancellationId: string;
	readonly state: "admitted" | "blocked";
	readonly runId: string;
	readonly adapterInputId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId: string;
	readonly providerId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly runAdmissionId: string;
	readonly attempt: number;
	readonly epoch: string;
	readonly manifestFingerprint: string;
	readonly hostBindingDigest: string;
	readonly sourceRefs: readonly SourceRef[];
}

export interface LocalUntrustedJsComputeCancellationAcknowledgement {
	readonly kind: "local-untrusted-js-compute-cancellation-acknowledgement";
	readonly admissionId: string;
	readonly cancellationId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly state: "accepted" | "rejected";
	readonly code?: string;
}

export interface LocalUntrustedJsComputeMaterialLoadContext {
	readonly input: ToolProviderAdapterInput<LocalUntrustedJsComputeArguments>;
	readonly request: ToolProviderAdapterRunRequested;
	readonly admission: ToolProviderRunAdmission;
	readonly manifest: LocalUntrustedJsComputeManifest;
	readonly readiness: LocalUntrustedJsComputeReadiness;
	readonly args: LocalUntrustedJsComputeArguments;
	readonly signal: AbortSignal;
}

export interface LocalUntrustedJsComputeRuntimeOptions {
	readonly name?: string;
	readonly inputs: Node<ToolProviderAdapterInput<LocalUntrustedJsComputeArguments>>;
	readonly admittedRunRequests: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly runAdmissions: readonly Node<ToolProviderRunAdmission>[];
	readonly manifests: readonly Node<LocalUntrustedJsComputeManifest>[];
	readonly readiness: readonly Node<LocalUntrustedJsComputeReadiness>[];
	readonly cancellationAdmissions?: readonly Node<LocalUntrustedJsComputeCancellationAdmission>[];
	readonly driver: LocalUntrustedJsComputeDriver;
	/**
	 * Host-private material authority. It must honor `context.signal` and must not settle
	 * until any material acquisition it owns has been released.
	 */
	readonly loadMaterial: (
		context: LocalUntrustedJsComputeMaterialLoadContext,
	) => LocalUntrustedJsComputeMaterial | PromiseLike<LocalUntrustedJsComputeMaterial>;
	readonly now?: () => number;
}

export interface LocalUntrustedJsComputeRuntimeBundle {
	readonly admittedRunRequests: Node<ToolProviderAdapterRunRequested>;
	readonly runStatus: Node<ToolProviderAdapterRunStatus>;
	readonly lifecycle: Node<LocalUntrustedJsComputeLifecycleFact>;
	readonly cleanup: Node<LocalUntrustedJsComputeCleanupStatus>;
	readonly outcomes: Node<ExecutorOutcome>;
	readonly usage: Node<LocalUntrustedJsComputeUsageFact>;
	readonly cancellations: Node<LocalUntrustedJsComputeCancellationAcknowledgement>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	dispose(): Promise<void>;
}

interface LocalUntrustedJsComputeActiveAttempt {
	readonly input: ToolProviderAdapterInput<LocalUntrustedJsComputeArguments>;
	readonly request: ToolProviderAdapterRunRequested;
	readonly admission: ToolProviderRunAdmission;
	readonly manifest: LocalUntrustedJsComputeManifest;
	readonly readiness: LocalUntrustedJsComputeReadiness;
	readonly args: LocalUntrustedJsComputeArguments;
	readonly abortController: AbortController;
	readonly startedAtMs: number;
	cancelled: boolean;
	settled: boolean;
}

/**
 * D667 Graph-visible runtime. Graph DATA carries immutable authority coordinates and bounded
 * results only; bundle/input bytes and the Podman socket remain behind loadMaterial/driver.
 */
export function localUntrustedJsComputeRuntime(
	graph: Graph,
	opts: LocalUntrustedJsComputeRuntimeOptions,
): LocalUntrustedJsComputeRuntimeBundle {
	if (opts.driver.compatibility !== LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY)
		throw new TypeError("Local untrusted JS compute driver compatibility mismatch.");
	const name = opts.name ?? "localUntrustedJsCompute";
	const group = graph.topologyGroup({ name });
	const outputNode = <T>(suffix: string, factory: string) =>
		group.node<T>([], null, {
			name: `${name}/${suffix}`,
			factory,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		});
	const admittedRunRequests = outputNode<ToolProviderAdapterRunRequested>(
		"admittedRunRequests",
		"localUntrustedJsComputeAdmittedRunRequests",
	);
	const runStatus = outputNode<ToolProviderAdapterRunStatus>(
		"runStatus",
		"localUntrustedJsComputeRunStatus",
	);
	const lifecycle = outputNode<LocalUntrustedJsComputeLifecycleFact>(
		"lifecycle",
		"localUntrustedJsComputeLifecycle",
	);
	const cleanup = outputNode<LocalUntrustedJsComputeCleanupStatus>(
		"cleanup",
		"localUntrustedJsComputeCleanup",
	);
	const outcomes = outputNode<ExecutorOutcome>("outcomes", "localUntrustedJsComputeOutcomes");
	const usage = outputNode<LocalUntrustedJsComputeUsageFact>(
		"usage",
		"localUntrustedJsComputeUsage",
	);
	const cancellations = outputNode<LocalUntrustedJsComputeCancellationAcknowledgement>(
		"cancellations",
		"localUntrustedJsComputeCancellations",
	);
	const issues = outputNode<DataIssue>("issues", "localUntrustedJsComputeIssues");
	const audit = outputNode<AgentRuntimeAuditRecord>("audit", "localUntrustedJsComputeAudit");
	const inputs = new Map<string, ToolProviderAdapterInput<LocalUntrustedJsComputeArguments>>();
	const admissions = new Map<string, ToolProviderRunAdmission>();
	const manifests = new Map<string, LocalUntrustedJsComputeManifest>();
	const readiness = new Map<string, LocalUntrustedJsComputeReadiness>();
	const active = new Map<string, LocalUntrustedJsComputeActiveAttempt>();
	const terminal = new Set<string>();
	const consumedCancellationAdmissions = new Set<string>();
	const pending = new Set<Promise<void>>();
	const now = opts.now ?? Date.now;
	let disposed = false;
	let disposePromise: Promise<void> | undefined;
	const emit = <T>(node: Node<T>, value: T) => node.down([["DATA", value]]);
	const emitIssue = (
		code: string,
		message: string,
		subjectId?: string,
		sourceRefs: readonly SourceRef[] = [],
	) => {
		const issue: DataIssue = Object.freeze({
			kind: "issue",
			code,
			message,
			severity: "error",
			...(subjectId === undefined ? {} : { subjectId }),
			...(sourceRefs.length === 0
				? {}
				: {
						refs: Object.freeze(
							sourceRefs.map((ref) => compoundTupleKey("source-ref", [ref.kind, ref.id])),
						),
					}),
		});
		emit(issues, issue);
		emit(audit, {
			id: compoundTupleKey("local-untrusted-js-compute-audit", [code, subjectId ?? "runtime"]),
			kind: code,
			...(subjectId === undefined ? {} : { subjectId }),
			issueCode: code,
			...(sourceRefs.length === 0 ? {} : { sourceRefs }),
		});
		return issue;
	};
	const emitStatus = (
		request: ToolProviderAdapterRunRequested,
		statusValue: ToolProviderAdapterRunStatus["status"],
		issue?: DataIssue,
		outcomeId?: string,
	) =>
		emit(runStatus, {
			kind: "tool-provider-adapter-run-status",
			runId: request.runId,
			adapterInputId: request.adapterInputId,
			requestId: request.requestId,
			operationId: request.operationId,
			attempt: request.attempt,
			status: statusValue,
			...(outcomeId === undefined ? {} : { outcomeId }),
			...(issue === undefined ? {} : { issues: [issue] }),
			sourceRefs: request.sourceRefs,
			metadata: {
				...(request.routeId === undefined ? {} : { routeId: request.routeId }),
				...(request.profileId === undefined ? {} : { profileId: request.profileId }),
			},
		});
	const emitLifecycle = (
		record: LocalUntrustedJsComputeActiveAttempt,
		state: LocalUntrustedJsComputeLifecycleState,
		sourceRefs: readonly SourceRef[] = record.request.sourceRefs ?? [],
	) => {
		const occurredAtMs = now();
		const fact: LocalUntrustedJsComputeLifecycleFact = Object.freeze({
			kind: "local-untrusted-js-compute-lifecycle-fact",
			state,
			runId: record.request.runId,
			attempt: record.request.attempt,
			epoch: record.args.epoch,
			manifestFingerprint: record.manifest.fingerprint,
			runAdmissionId: record.admission.admissionId,
			occurredAtMs,
			...(sourceRefs.length === 0 ? {} : { sourceRefs: Object.freeze([...sourceRefs]) }),
		});
		emit(lifecycle, fact);
		emit(audit, {
			id: compoundTupleKey("local-untrusted-js-compute-lifecycle-audit", [
				fact.runId,
				String(fact.attempt),
				state,
				String(occurredAtMs),
			]),
			kind: `local-untrusted-js-compute-${state}`,
			subjectId: fact.runId,
			sourceRefs: fact.sourceRefs,
			metadata: {
				attempt: fact.attempt,
				epoch: fact.epoch,
				manifestFingerprint: fact.manifestFingerprint,
				runAdmissionId: fact.runAdmissionId,
			},
		});
	};
	const track = (work: Promise<void>) => {
		pending.add(work);
		void work.finally(() => pending.delete(work));
	};
	const failRequest = (
		request: ToolProviderAdapterRunRequested,
		code: string,
		statusValue: ToolProviderAdapterRunStatus["status"],
	) => {
		const issue = emitIssue(
			code,
			"Local untrusted JS compute admission failed closed.",
			request.runId,
			request.sourceRefs,
		);
		emitStatus(request, statusValue, issue);
	};
	const execute = async (record: LocalUntrustedJsComputeActiveAttempt) => {
		let driverOutcome: LocalUntrustedJsComputeDriverOutcome;
		try {
			emitLifecycle(record, "loading-material");
			const material = await opts.loadMaterial(
				Object.freeze({
					input: record.input,
					request: record.request,
					admission: record.admission,
					manifest: record.manifest,
					readiness: record.readiness,
					args: record.args,
					signal: record.abortController.signal,
				}),
			);
			if (disposed) return;
			emitLifecycle(record, "running");
			emitStatus(record.request, "started");
			driverOutcome = await runLocalUntrustedJsComputeAttempt({
				manifest: record.manifest,
				readiness: record.readiness,
				args: record.args,
				material,
				adapterInput: record.input,
				admittedRunRequest: record.request,
				runAdmission: record.admission,
				driver: opts.driver,
				signal: record.abortController.signal,
				now,
			});
		} catch {
			driverOutcome = Object.freeze({
				outcome: record.cancelled ? "canceled" : "failed",
				code: record.cancelled
					? "local-untrusted-js-compute-canceled"
					: "local-untrusted-js-compute-runtime-failed",
				cleanup: record.cancelled ? "unverifiable" : "failed",
			});
		}
		if (disposed) return;
		record.settled = true;
		emitLifecycle(record, "cleaning");
		const latencyMs = Math.max(0, now() - record.startedAtMs);
		const executorUsage: ExecutorUsage = Object.freeze({ latencyMs });
		const usageFact: LocalUntrustedJsComputeUsageFact = Object.freeze({
			kind: "local-untrusted-js-compute-usage",
			runId: record.request.runId,
			attempt: record.request.attempt,
			latencyMs,
		});
		emit(usage, usageFact);
		const sourceRefs: readonly SourceRef[] = Object.freeze([
			{ kind: "tool-provider-run-admission", id: record.admission.admissionId },
			{ kind: "local-untrusted-js-compute-manifest", id: record.manifest.manifestId },
			...(record.request.sourceRefs ?? []),
		]);
		let outcome: ExecutorOutcome;
		if (driverOutcome.outcome === "succeeded") {
			outcome = buildToolProviderExecutorOutcome(
				record.input,
				{
					kind: "result",
					result: {
						kind: "local-untrusted-js-compute-result",
						value: driverOutcome.result,
						refs: sourceRefs,
						summary:
							"Local GraphReFly JavaScript execution completed with topology and provenance.",
					},
					evidenceRefs: sourceRefs,
					usage: executorUsage,
					occurredAtMs: now(),
					metadata: {
						manifestFingerprint: record.manifest.fingerprint,
						epoch: record.args.epoch,
						runAdmissionId: record.admission.admissionId,
						cleanup: driverOutcome.cleanup,
					},
				},
				{ runId: record.request.runId, attempt: record.request.attempt },
			);
		} else {
			const problem = emitIssue(
				driverOutcome.code,
				"Local untrusted JS compute attempt did not produce a successful result.",
				record.request.runId,
				sourceRefs,
			);
			const common = {
				evidenceRefs: sourceRefs,
				issues: [problem],
				usage: executorUsage,
				occurredAtMs: now(),
				metadata: {
					manifestFingerprint: record.manifest.fingerprint,
					epoch: record.args.epoch,
					runAdmissionId: record.admission.admissionId,
					cleanup: driverOutcome.cleanup,
				},
			};
			outcome =
				driverOutcome.outcome === "timeout"
					? buildToolProviderExecutorOutcome(
							record.input,
							{
								kind: "timeout",
								timeoutMs: record.manifest.executionTimeoutMs,
								retryable: false,
								...common,
							},
							{ runId: record.request.runId, attempt: record.request.attempt },
						)
					: driverOutcome.outcome === "canceled"
						? buildToolProviderExecutorOutcome(
								record.input,
								{ kind: "canceled", reason: driverOutcome.code, ...common },
								{ runId: record.request.runId, attempt: record.request.attempt },
							)
						: buildToolProviderExecutorOutcome(
								record.input,
								{ kind: "failure", error: problem, retryable: false, ...common },
								{ runId: record.request.runId, attempt: record.request.attempt },
							);
		}
		emit(outcomes, outcome);
		emitStatus(record.request, outcome.kind, undefined, outcome.outcomeId);
		const cleanupIssue =
			driverOutcome.cleanup === "succeeded"
				? undefined
				: emitIssue(
						`local-untrusted-js-compute-cleanup-${driverOutcome.cleanup}`,
						"Local untrusted JS compute cleanup was not proven.",
						record.request.runId,
						sourceRefs,
					);
		emit(cleanup, {
			kind: "local-untrusted-js-compute-cleanup-status",
			runId: record.request.runId,
			attempt: record.request.attempt,
			epoch: record.args.epoch,
			state: driverOutcome.cleanup,
			...(cleanupIssue === undefined ? {} : { issue: cleanupIssue }),
		});
		emitLifecycle(record, "settled", sourceRefs);
		active.delete(runtimeAttemptKey(record.request));
		terminal.add(runtimeAttemptKey(record.request));
	};
	const unsubscribes = [
		opts.inputs.subscribe((message) => {
			if (message[0] !== "DATA" || disposed) return;
			const value = message[1] as ToolProviderAdapterInput<LocalUntrustedJsComputeArguments>;
			if (!plain(value) || value.kind !== "tool-provider-adapter-input") {
				emitIssue(
					"local-untrusted-js-compute-input-invalid",
					"Local untrusted JS compute input is invalid.",
				);
				return;
			}
			inputs.set(value.adapterInputId, value);
		}),
		...opts.runAdmissions.map((node) =>
			node.subscribe((message) => {
				if (message[0] !== "DATA" || disposed) return;
				const value = message[1] as ToolProviderRunAdmission;
				if (!plain(value) || value.kind !== "tool-provider-run-admission") {
					emitIssue(
						"local-untrusted-js-compute-run-admission-invalid",
						"Local untrusted JS compute run admission is invalid.",
					);
					return;
				}
				admissions.set(value.admissionId, value);
			}),
		),
		...opts.manifests.map((node) =>
			node.subscribe((message) => {
				if (message[0] !== "DATA" || disposed) return;
				try {
					const value = localUntrustedJsComputeManifest(
						message[1] as LocalUntrustedJsComputeManifest,
					);
					manifests.set(value.fingerprint, value);
				} catch {
					emitIssue(
						"local-untrusted-js-compute-manifest-invalid",
						"Local untrusted JS compute manifest is invalid.",
					);
				}
			}),
		),
		...opts.readiness.map((node) =>
			node.subscribe((message) => {
				if (message[0] !== "DATA" || disposed) return;
				const raw = message[1] as LocalUntrustedJsComputeReadiness;
				if (!plain(raw) || typeof raw.manifestFingerprint !== "string") {
					emitIssue(
						"local-untrusted-js-compute-readiness-invalid",
						"Local untrusted JS compute readiness is invalid.",
					);
					return;
				}
				readiness.set(raw.manifestFingerprint, raw);
			}),
		),
		...opts.admittedRunRequests.map((node) =>
			node.subscribe((message) => {
				if (message[0] !== "DATA" || disposed) return;
				const request = message[1] as ToolProviderAdapterRunRequested;
				const work = Promise.resolve().then(async () => {
					if (!plain(request) || request.kind !== "tool-provider-adapter-run-requested") {
						emitIssue(
							"local-untrusted-js-compute-run-request-invalid",
							"Local untrusted JS compute run request is invalid.",
						);
						return;
					}
					const key = runtimeAttemptKey(request);
					if (active.has(key) || terminal.has(key)) {
						failRequest(request, "local-untrusted-js-compute-duplicate-run", "stale-request");
						return;
					}
					const input = inputs.get(request.adapterInputId);
					const admissionId = request.metadata?.admissionId;
					const manifestFingerprint = request.metadata?.manifestFingerprint;
					if (
						input === undefined ||
						typeof admissionId !== "string" ||
						typeof manifestFingerprint !== "string"
					) {
						failRequest(
							request,
							"local-untrusted-js-compute-admission-context-missing",
							input === undefined ? "missing-input" : "missing-request",
						);
						return;
					}
					const admission = admissions.get(admissionId);
					const manifest = manifests.get(manifestFingerprint);
					const posture = readiness.get(manifestFingerprint);
					if (admission === undefined || manifest === undefined || posture === undefined) {
						failRequest(
							request,
							"local-untrusted-js-compute-admission-context-stale",
							"missing-request",
						);
						return;
					}
					try {
						const safeManifest = localUntrustedJsComputeManifest(manifest);
						const safeReadiness = localUntrustedJsComputeReadiness(posture, safeManifest, now());
						const safeArgs = localUntrustedJsComputeArguments(
							input.toolCall?.arguments as LocalUntrustedJsComputeArguments,
							safeManifest,
						);
						validateAdmission(input, request, admission, safeArgs);
						const record: LocalUntrustedJsComputeActiveAttempt = {
							input,
							request,
							admission,
							manifest: safeManifest,
							readiness: safeReadiness,
							args: safeArgs,
							abortController: new AbortController(),
							startedAtMs: now(),
							cancelled: false,
							settled: false,
						};
						active.set(key, record);
						emitLifecycle(record, "admitted");
						emitStatus(request, "requested");
						emit(admittedRunRequests, request);
						await execute(record);
					} catch {
						failRequest(
							request,
							"local-untrusted-js-compute-admission-mismatch",
							"mismatched-request",
						);
					}
				});
				track(work);
			}),
		),
		...(opts.cancellationAdmissions ?? []).map((node) =>
			node.subscribe((message) => {
				if (message[0] !== "DATA" || disposed) return;
				const admission = message[1] as LocalUntrustedJsComputeCancellationAdmission;
				const reject = (code: string) => {
					const cancellationId =
						plain(admission) && typeof admission.cancellationId === "string"
							? admission.cancellationId
							: "invalid";
					const admissionId =
						plain(admission) && typeof admission.admissionId === "string"
							? admission.admissionId
							: "invalid";
					const runId =
						plain(admission) && typeof admission.runId === "string" ? admission.runId : "invalid";
					const attempt =
						plain(admission) && Number.isSafeInteger(admission.attempt)
							? Number(admission.attempt)
							: 1;
					emitIssue(
						code,
						"Cancellation did not exactly match an active local untrusted JS attempt.",
						runId,
					);
					emit(cancellations, {
						kind: "local-untrusted-js-compute-cancellation-acknowledgement",
						admissionId,
						cancellationId,
						runId,
						attempt,
						state: "rejected",
						code,
					});
				};
				if (
					!plain(admission) ||
					admission.kind !== "local-untrusted-js-compute-cancellation-admission"
				) {
					reject("local-untrusted-js-compute-cancellation-invalid");
					return;
				}
				const record = active.get(runtimeAttemptKey(admission));
				if (
					admission.state !== "admitted" ||
					record === undefined ||
					record.settled ||
					record.cancelled ||
					consumedCancellationAdmissions.has(admission.admissionId) ||
					!cancellationMatchesLocalAttempt(admission, record)
				) {
					reject("local-untrusted-js-compute-cancellation-coordinate-mismatch");
					return;
				}
				record.cancelled = true;
				consumedCancellationAdmissions.add(admission.admissionId);
				record.abortController.abort();
				emit(cancellations, {
					kind: "local-untrusted-js-compute-cancellation-acknowledgement",
					admissionId: admission.admissionId,
					cancellationId: admission.cancellationId,
					runId: admission.runId,
					attempt: admission.attempt,
					state: "accepted",
				});
				emit(audit, {
					id: compoundTupleKey("local-untrusted-js-compute-cancellation-audit", [
						admission.admissionId,
						admission.cancellationId,
					]),
					kind: "local-untrusted-js-compute-cancellation-accepted",
					subjectId: admission.runId,
					sourceRefs: admission.sourceRefs,
					metadata: {
						attempt: admission.attempt,
						epoch: admission.epoch,
						runAdmissionId: admission.runAdmissionId,
					},
				});
			}),
		),
	];
	return {
		admittedRunRequests,
		runStatus,
		lifecycle,
		cleanup,
		outcomes,
		usage,
		cancellations,
		issues,
		audit,
		dispose() {
			if (disposePromise === undefined) {
				disposed = true;
				for (const unsubscribe of unsubscribes) unsubscribe();
				for (const record of active.values()) {
					record.cancelled = true;
					record.abortController.abort();
				}
				disposePromise = Promise.allSettled([...pending]).then(() => {
					active.clear();
					terminal.clear();
					consumedCancellationAdmissions.clear();
					inputs.clear();
					admissions.clear();
					manifests.clear();
					readiness.clear();
					group.release({ reason: `${name}:dispose` });
				});
			}
			return disposePromise;
		},
	};
}

export async function runLocalUntrustedJsComputeAttempt(
	opts: RunLocalUntrustedJsComputeAttemptOptions,
): Promise<LocalUntrustedJsComputeDriverOutcome> {
	const manifest = localUntrustedJsComputeManifest(opts.manifest);
	const readiness = localUntrustedJsComputeReadiness(
		opts.readiness,
		manifest,
		opts.now?.() ?? Date.now(),
	);
	const args = localUntrustedJsComputeArguments(opts.args, manifest);
	validateAdmission(opts.adapterInput, opts.admittedRunRequest, opts.runAdmission, args);
	if (opts.driver.compatibility !== LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY)
		throw new TypeError("Local untrusted JS compute driver compatibility mismatch.");
	if (readiness.state !== "ready")
		throw new TypeError("Local untrusted JS compute readiness is not current and ready.");
	if (
		opts.material.bundle.byteLength === 0 ||
		opts.material.bundle.byteLength > manifest.maxBundleBytes
	)
		throw new TypeError("Local untrusted JS compute bundle exceeds the admitted byte bound.");
	const inputBytes = jsonBytes(opts.material.input, "local untrusted JS compute input");
	if (inputBytes > manifest.maxInputBytes)
		throw new TypeError("Local untrusted JS compute input exceeds the admitted byte bound.");
	if ((await sha256(opts.material.bundle)) !== args.bundleDigest)
		throw new TypeError(
			"Local untrusted JS compute bundle bytes do not match the admitted digest.",
		);
	if ((await sha256(strictCanonicalJsonBytes(opts.material.input))) !== args.inputDigest)
		throw new TypeError("Local untrusted JS compute input bytes do not match the admitted digest.");
	if (opts.signal.aborted)
		return Object.freeze({
			outcome: "canceled",
			code: "local-untrusted-js-compute-canceled-before-allocation",
			cleanup: "succeeded",
		});
	const outcome = await opts.driver.execute(
		Object.freeze({
			runId: args.runId,
			attempt: args.attempt,
			epoch: args.epoch,
			manifestFingerprint: manifest.fingerprint,
			hostBindingDigest: readiness.hostBindingDigest,
			runAdmissionId: opts.runAdmission.admissionId,
			signal: opts.signal,
		}),
		args,
		Object.freeze({
			bundle: new Uint8Array(opts.material.bundle),
			input: cloneJson(opts.material.input, "local untrusted JS compute input"),
		}),
		manifest,
	);
	return localUntrustedJsComputeDriverOutcome(
		outcome,
		args,
		manifest,
		opts.runAdmission.admissionId,
	);
}

export function localUntrustedJsComputeManifest(
	value: LocalUntrustedJsComputeManifest,
): LocalUntrustedJsComputeManifest {
	exactKeys(value, [
		"kind",
		"manifestId",
		"revision",
		"fingerprint",
		"compatibilityRevision",
		"backend",
		"runnerApiRevision",
		"runnerImageDigest",
		"runnerRevision",
		"compilerRevision",
		"allowedApiRevision",
		"graphreflyPackageRevision",
		"sandboxPolicyRevision",
		"networkPolicyRevision",
		"filesystemPolicyRevision",
		"resourcePolicyRevision",
		"outputPolicyRevision",
		"executionTimeoutMs",
		"killGraceMs",
		"cleanupTimeoutMs",
		"maxBundleBytes",
		"maxInputBytes",
		"maxOutputBytes",
		"maxTopologyNodes",
		"maxTopologyEdges",
	]);
	if (
		value.kind !== "local-untrusted-js-compute-manifest" ||
		value.compatibilityRevision !== LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY ||
		value.backend !== LOCAL_UNTRUSTED_JS_COMPUTE_BACKEND ||
		value.runnerApiRevision !== LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API ||
		value.networkPolicyRevision !== "deny-all-v1" ||
		value.filesystemPolicyRevision !== "read-only-input-bounded-tmp-v1"
	)
		throw new TypeError("Invalid local untrusted JS compute manifest identity.");
	for (const entry of [
		value.manifestId,
		value.revision,
		value.fingerprint,
		value.runnerRevision,
		value.compilerRevision,
		value.allowedApiRevision,
		value.graphreflyPackageRevision,
		value.sandboxPolicyRevision,
		value.resourcePolicyRevision,
		value.outputPolicyRevision,
	])
		safe(entry, "local untrusted JS compute manifest coordinate");
	digest(value.runnerImageDigest, "runnerImageDigest");
	for (const entry of [
		value.executionTimeoutMs,
		value.killGraceMs,
		value.cleanupTimeoutMs,
		value.maxBundleBytes,
		value.maxInputBytes,
		value.maxOutputBytes,
		value.maxTopologyNodes,
		value.maxTopologyEdges,
	])
		positive(entry, "local untrusted JS compute manifest bound");
	if (
		value.executionTimeoutMs > MAX_EXECUTION_TIMEOUT_MS ||
		value.killGraceMs > MAX_KILL_GRACE_MS ||
		value.cleanupTimeoutMs > MAX_CLEANUP_TIMEOUT_MS ||
		value.maxBundleBytes > MAX_MATERIAL_BYTES ||
		value.maxInputBytes > MAX_MATERIAL_BYTES ||
		value.maxOutputBytes > MAX_MATERIAL_BYTES ||
		value.maxTopologyNodes > MAX_TOPOLOGY_NODES ||
		value.maxTopologyEdges > MAX_TOPOLOGY_EDGES
	)
		throw new TypeError("Local untrusted JS compute manifest bound exceeds the v0 ceiling.");
	if (value.killGraceMs % 1_000 !== 0)
		throw new TypeError("Local untrusted JS compute kill grace must use whole seconds.");
	return Object.freeze({ ...value });
}

export function localUntrustedJsComputeReadiness(
	value: LocalUntrustedJsComputeReadiness,
	manifest: LocalUntrustedJsComputeManifest,
	now: number,
): LocalUntrustedJsComputeReadiness {
	exactKeys(value, [
		"kind",
		"manifestFingerprint",
		"state",
		"observedAtMs",
		"expiresAtMs",
		"rootlessVerified",
		"imageDigestVerified",
		"runnerVerified",
		"nonRootVerified",
		"readOnlyRootFilesystemVerified",
		"noNewPrivilegesVerified",
		"capabilitiesDroppedVerified",
		"noEngineSocketMountVerified",
		"noHostBindMountVerified",
		"denyNetworkVerified",
		"resourceBoundsVerified",
		"cancellationVerified",
		"cleanupVerified",
		"hostBindingDigest",
		"attestationRefs",
	]);
	if (
		value.kind !== "local-untrusted-js-compute-readiness" ||
		value.manifestFingerprint !== manifest.fingerprint ||
		value.state !== "ready" ||
		!Number.isSafeInteger(value.observedAtMs) ||
		!Number.isSafeInteger(value.expiresAtMs) ||
		value.observedAtMs > now ||
		value.expiresAtMs <= now
	)
		throw new TypeError("Invalid or stale local untrusted JS compute readiness.");
	const required = [
		value.rootlessVerified,
		value.imageDigestVerified,
		value.runnerVerified,
		value.nonRootVerified,
		value.readOnlyRootFilesystemVerified,
		value.noNewPrivilegesVerified,
		value.capabilitiesDroppedVerified,
		value.noEngineSocketMountVerified,
		value.noHostBindMountVerified,
		value.denyNetworkVerified,
		value.resourceBoundsVerified,
		value.cancellationVerified,
		value.cleanupVerified,
	];
	if (required.some((entry) => entry !== true))
		throw new TypeError("Local untrusted JS compute readiness lacks required certification.");
	digest(value.hostBindingDigest, "readiness hostBindingDigest");
	const attestationRefs = stringList(value.attestationRefs, "readiness attestationRefs");
	if (attestationRefs.length === 0)
		throw new TypeError("Local untrusted JS compute readiness needs attestation refs.");
	return Object.freeze({ ...value, attestationRefs });
}

export function localUntrustedJsComputeArguments(
	value: LocalUntrustedJsComputeArguments,
	manifest: LocalUntrustedJsComputeManifest,
): LocalUntrustedJsComputeArguments {
	exactKeys(value, [
		"contractVersion",
		"runId",
		"attempt",
		"epoch",
		"sourceRevision",
		"sourceDigest",
		"bundleRevision",
		"bundleDigest",
		"compilerRevision",
		"allowedApiRevision",
		"graphreflyPackageRevision",
		"runnerRevision",
		"runnerImageDigest",
		"sandboxPolicyRevision",
		"networkPolicyRevision",
		"filesystemPolicyRevision",
		"resourcePolicyRevision",
		"outputPolicyRevision",
		"admittedInputRefs",
		"inputDigest",
	]);
	if (
		value.contractVersion !== "1" ||
		value.attempt < 1 ||
		!Number.isSafeInteger(value.attempt) ||
		value.compilerRevision !== manifest.compilerRevision ||
		value.allowedApiRevision !== manifest.allowedApiRevision ||
		value.graphreflyPackageRevision !== manifest.graphreflyPackageRevision ||
		value.runnerRevision !== manifest.runnerRevision ||
		value.runnerImageDigest !== manifest.runnerImageDigest ||
		value.sandboxPolicyRevision !== manifest.sandboxPolicyRevision ||
		value.networkPolicyRevision !== manifest.networkPolicyRevision ||
		value.filesystemPolicyRevision !== manifest.filesystemPolicyRevision ||
		value.resourcePolicyRevision !== manifest.resourcePolicyRevision ||
		value.outputPolicyRevision !== manifest.outputPolicyRevision
	)
		throw new TypeError("Local untrusted JS compute arguments do not match the manifest.");
	for (const entry of [
		value.runId,
		value.epoch,
		value.sourceRevision,
		value.bundleRevision,
		value.compilerRevision,
		value.allowedApiRevision,
		value.graphreflyPackageRevision,
		value.runnerRevision,
		value.sandboxPolicyRevision,
		value.resourcePolicyRevision,
		value.outputPolicyRevision,
	])
		safe(entry, "local untrusted JS compute argument coordinate");
	digest(value.sourceDigest, "sourceDigest");
	digest(value.bundleDigest, "bundleDigest");
	digest(value.inputDigest, "inputDigest");
	const admittedInputRefs = stringList(value.admittedInputRefs, "admittedInputRefs");
	if (admittedInputRefs.length === 0)
		throw new TypeError("Local untrusted JS compute requires admitted input refs.");
	return Object.freeze({ ...value, admittedInputRefs });
}

function localUntrustedJsComputeDriverOutcome(
	value: LocalUntrustedJsComputeDriverOutcome,
	args: LocalUntrustedJsComputeArguments,
	manifest: LocalUntrustedJsComputeManifest,
	runAdmissionId: string,
): LocalUntrustedJsComputeDriverOutcome {
	if (
		!plain(value) ||
		!["succeeded", "failed", "timeout", "canceled"].includes(String(value.outcome))
	)
		throw new TypeError("Invalid local untrusted JS compute driver outcome.");
	if (!["succeeded", "failed", "unverifiable"].includes(String(value.cleanup)))
		throw new TypeError("Invalid local untrusted JS compute cleanup state.");
	if (value.outcome !== "succeeded") {
		safe(value.code, "local untrusted JS compute outcome code");
		return Object.freeze({ outcome: value.outcome, code: value.code, cleanup: value.cleanup });
	}
	if (value.cleanup !== "succeeded")
		return Object.freeze({
			outcome: "failed",
			code: "local-untrusted-js-compute-cleanup-not-verified",
			cleanup: value.cleanup,
		});
	const result = runnerResult(value.result, args, manifest, runAdmissionId);
	if (jsonBytes(result, "local untrusted JS compute result") > manifest.maxOutputBytes)
		throw new TypeError("Local untrusted JS compute result exceeds the output byte bound.");
	return Object.freeze({ outcome: "succeeded", result, cleanup: "succeeded" });
}

function runnerResult(
	value: LocalUntrustedJsComputeRunnerResult,
	args: LocalUntrustedJsComputeArguments,
	manifest: LocalUntrustedJsComputeManifest,
	runAdmissionId: string,
): LocalUntrustedJsComputeRunnerResult {
	exactKeys(value, ["contractVersion", "answer", "topology", "describe", "provenance", "cleanup"]);
	exactKeys(value.provenance, [
		"sourceRevision",
		"sourceDigest",
		"bundleRevision",
		"bundleDigest",
		"compilerRevision",
		"allowedApiRevision",
		"graphreflyPackageRevision",
		"runnerRevision",
		"runnerImageDigest",
		"manifestFingerprint",
		"runId",
		"attempt",
		"graphName",
		"admittedInputRefs",
		"inputDigest",
		"runAdmissionId",
	]);
	exactKeys(value.cleanup, ["graphNodesAfterDispose", "graphEdgesAfterDispose"]);
	if (
		value.contractVersion !== "1" ||
		value.provenance.runId !== args.runId ||
		value.provenance.attempt !== args.attempt ||
		value.provenance.sourceRevision !== args.sourceRevision ||
		value.provenance.sourceDigest !== args.sourceDigest ||
		value.provenance.bundleRevision !== args.bundleRevision ||
		value.provenance.bundleDigest !== args.bundleDigest ||
		value.provenance.compilerRevision !== args.compilerRevision ||
		value.provenance.allowedApiRevision !== args.allowedApiRevision ||
		value.provenance.graphreflyPackageRevision !== args.graphreflyPackageRevision ||
		value.provenance.runnerRevision !== args.runnerRevision ||
		value.provenance.runnerImageDigest !== args.runnerImageDigest ||
		value.provenance.manifestFingerprint !== manifest.fingerprint ||
		value.provenance.inputDigest !== args.inputDigest ||
		value.provenance.runAdmissionId !== runAdmissionId ||
		!sameStrings(value.provenance.admittedInputRefs, args.admittedInputRefs) ||
		!plain(value.cleanup) ||
		value.cleanup.graphNodesAfterDispose !== 0 ||
		value.cleanup.graphEdgesAfterDispose !== 0
	)
		throw new TypeError("Local untrusted JS compute runner result has mismatched provenance.");
	const answer = cloneJson(value.answer, "local untrusted JS compute answer");
	const topology = validateTopologySnapshot(value.topology, manifest);
	const describe = validateDescribeSnapshot(value.describe, manifest);
	if (
		JSON.stringify(topology) !== JSON.stringify(topologyFromDescribe(describe)) ||
		topology.name !== value.provenance.graphName ||
		describe.name !== value.provenance.graphName
	)
		throw new TypeError("Local untrusted JS compute topology and describe snapshots disagree.");
	const provenance = Object.freeze({
		sourceRevision: value.provenance.sourceRevision,
		sourceDigest: value.provenance.sourceDigest,
		bundleRevision: value.provenance.bundleRevision,
		bundleDigest: value.provenance.bundleDigest,
		compilerRevision: value.provenance.compilerRevision,
		allowedApiRevision: value.provenance.allowedApiRevision,
		graphreflyPackageRevision: value.provenance.graphreflyPackageRevision,
		runnerRevision: value.provenance.runnerRevision,
		runnerImageDigest: value.provenance.runnerImageDigest,
		manifestFingerprint: value.provenance.manifestFingerprint,
		runId: value.provenance.runId,
		attempt: value.provenance.attempt,
		graphName: value.provenance.graphName,
		admittedInputRefs: Object.freeze([...value.provenance.admittedInputRefs]),
		inputDigest: value.provenance.inputDigest,
		runAdmissionId: value.provenance.runAdmissionId,
	});
	safe(provenance.graphName, "local untrusted JS compute graph name");
	return Object.freeze({
		contractVersion: "1",
		answer,
		topology,
		describe,
		provenance: Object.freeze(provenance),
		cleanup: Object.freeze({ graphNodesAfterDispose: 0, graphEdgesAfterDispose: 0 }),
	});
}

function validateAdmission(
	input: ToolProviderAdapterInput<LocalUntrustedJsComputeArguments>,
	request: ToolProviderAdapterRunRequested,
	admission: ToolProviderRunAdmission,
	args: LocalUntrustedJsComputeArguments,
): void {
	safe(admission.admissionId, "local untrusted JS compute run admission id");
	const admissionRefs =
		request.sourceRefs?.filter((ref) => ref.kind === "tool-provider-run-admission") ?? [];
	const admissionRefPresent = admissionRefs.some(
		(ref) => ref.kind === "tool-provider-run-admission" && ref.id === admission.admissionId,
	);
	if (
		!plain(input) ||
		input.kind !== "tool-provider-adapter-input" ||
		input.status !== "ready" ||
		!plain(request) ||
		request.kind !== "tool-provider-adapter-run-requested" ||
		!plain(admission) ||
		admission.kind !== "tool-provider-run-admission" ||
		admission.state !== "admitted" ||
		admission.approvedRunId !== request.runId ||
		admission.adapterInputId !== input.adapterInputId ||
		admission.requestId !== input.requestId ||
		admission.operationId !== input.operationId ||
		request.runId !== args.runId ||
		request.attempt !== args.attempt ||
		request.adapterInputId !== input.adapterInputId ||
		request.requestId !== input.requestId ||
		request.operationId !== input.operationId ||
		request.routeId !== input.routeId ||
		request.providerId !== input.providerId ||
		request.executorId !== input.executorId ||
		request.profileId !== input.profileId ||
		input.toolName !== "graphrefly.local-untrusted-js-compute" ||
		input.operation !== "run" ||
		input.toolCall?.kind !== "tool-call" ||
		input.toolCall.toolName !== input.toolName ||
		input.toolCall.operation !== input.operation ||
		input.toolCall.arguments === undefined ||
		request.metadata?.approval !== "granted" ||
		request.metadata.approvalGranted !== true ||
		request.metadata.admissionId !== admission.admissionId ||
		request.metadata.proposalId !== admission.proposalId ||
		request.metadata.approvedFromRunId !== admission.runId ||
		admissionRefs.length !== 1 ||
		admissionRefPresent !== true ||
		!sameBytes(strictCanonicalJsonBytes(input.toolCall.arguments), strictCanonicalJsonBytes(args))
	)
		throw new TypeError("Local untrusted JS compute D419 admission coordinates do not match.");
	for (const coordinate of [
		input.adapterInputId,
		input.requestId,
		input.operationId,
		input.routeId,
		input.providerId,
		input.executorId,
		input.profileId,
		request.reason,
	])
		safe(coordinate, "local untrusted JS compute D419 coordinate");
}

interface TopologyBudget {
	nodes: number;
	edges: number;
	readonly nodeIds: Set<string>;
	readonly mountIds: Set<string>;
}

function validateTopologySnapshot(
	value: unknown,
	manifest: LocalUntrustedJsComputeManifest,
): GraphTopologySnapshot {
	const budget: TopologyBudget = {
		nodes: 0,
		edges: 0,
		nodeIds: new Set(),
		mountIds: new Set(),
	};
	return topologySnapshot(value, manifest, budget, 0);
}

function topologySnapshot(
	value: unknown,
	manifest: LocalUntrustedJsComputeManifest,
	budget: TopologyBudget,
	depth: number,
): GraphTopologySnapshot {
	if (depth > 32) throw new TypeError("Local untrusted JS compute topology is too deeply nested.");
	exactOptionalKeys(value, ["nodes", "edges"], ["mountId", "name", "subgraphs"]);
	if (!Array.isArray(value.nodes) || !Array.isArray(value.edges))
		throw new TypeError("Local untrusted JS compute topology has an invalid shape.");
	budget.nodes += value.nodes.length;
	budget.edges += value.edges.length;
	if (budget.nodes > manifest.maxTopologyNodes || budget.edges > manifest.maxTopologyEdges)
		throw new TypeError("Local untrusted JS compute topology exceeds its bounds.");
	const nodes = value.nodes.map((node) => topologyNode(node));
	const ids = new Set(nodes.map((node) => node.id));
	if (ids.size !== nodes.length)
		throw new TypeError("Local untrusted JS compute topology has duplicate node ids.");
	for (const node of nodes) {
		if (budget.nodeIds.has(node.id))
			throw new TypeError("Local untrusted JS compute topology has duplicate global node ids.");
		budget.nodeIds.add(node.id);
	}
	const expectedEdges = new Set<string>();
	for (const node of nodes) {
		for (const dep of node.deps) {
			if (!ids.has(dep))
				throw new TypeError("Local untrusted JS compute topology has an unknown dependency.");
			expectedEdges.add(`${dep}\n${node.id}`);
		}
	}
	const edges = value.edges.map((edge) => topologyEdge(edge));
	const observedEdges = new Set(edges.map((edge) => `${edge.from}\n${edge.to}`));
	if (
		observedEdges.size !== edges.length ||
		observedEdges.size !== expectedEdges.size ||
		[...observedEdges].some((edge) => !expectedEdges.has(edge))
	)
		throw new TypeError("Local untrusted JS compute topology edges disagree with node deps.");
	const out: GraphTopologySnapshot = { nodes, edges };
	if (depth === 0 && value.mountId !== undefined)
		throw new TypeError("Local untrusted JS compute root topology must not have a mount id.");
	if (depth > 0 && value.mountId === undefined)
		throw new TypeError("Local untrusted JS compute child topology requires a mount id.");
	if (value.mountId !== undefined) {
		safe(value.mountId, "local untrusted JS compute topology mount id");
		if (budget.mountIds.has(value.mountId))
			throw new TypeError("Local untrusted JS compute topology has duplicate mount ids.");
		budget.mountIds.add(value.mountId);
		out.mountId = value.mountId;
	}
	if (value.name !== undefined) {
		safe(value.name, "local untrusted JS compute topology name");
		out.name = value.name;
	}
	if (value.subgraphs !== undefined) {
		if (!Array.isArray(value.subgraphs))
			throw new TypeError("Local untrusted JS compute topology subgraphs must be an array.");
		out.subgraphs = value.subgraphs.map((entry) =>
			topologySnapshot(entry, manifest, budget, depth + 1),
		);
	}
	return Object.freeze(out);
}

function topologyNode(value: unknown): GraphTopologySnapshot["nodes"][number] {
	exactOptionalKeys(value, ["id", "factory", "deps"], ["name", "meta"]);
	safe(value.id, "local untrusted JS compute topology node id");
	safe(value.factory, "local untrusted JS compute topology node factory");
	if (!Array.isArray(value.deps))
		throw new TypeError("Local untrusted JS compute topology node deps must be an array.");
	const deps = stringList(value.deps, "local untrusted JS compute topology node deps");
	const out: GraphTopologySnapshot["nodes"][number] = {
		id: value.id,
		factory: value.factory,
		deps: [...deps],
	};
	if (value.name !== undefined) {
		safe(value.name, "local untrusted JS compute topology node name");
		out.name = value.name;
	}
	if (value.meta !== undefined) {
		const meta = cloneJson(value.meta, "local untrusted JS compute topology node meta");
		if (!plain(meta))
			throw new TypeError("Local untrusted JS compute topology node meta must be an object.");
		out.meta = meta;
	}
	return Object.freeze(out);
}

function topologyEdge(value: unknown): GraphTopologySnapshot["edges"][number] {
	exactKeys(value, ["from", "to"]);
	safe(value.from, "local untrusted JS compute topology edge source");
	safe(value.to, "local untrusted JS compute topology edge target");
	return Object.freeze({ from: value.from, to: value.to });
}

function validateDescribeSnapshot(
	value: unknown,
	manifest: LocalUntrustedJsComputeManifest,
): DescribeSnapshot {
	const budget: TopologyBudget = {
		nodes: 0,
		edges: 0,
		nodeIds: new Set(),
		mountIds: new Set(),
	};
	return describeSnapshot(value, manifest, budget, 0);
}

function describeSnapshot(
	value: unknown,
	manifest: LocalUntrustedJsComputeManifest,
	budget: TopologyBudget,
	depth: number,
): DescribeSnapshot {
	if (depth > 32) throw new TypeError("Local untrusted JS compute describe is too deeply nested.");
	exactOptionalKeys(value, ["nodes", "edges"], ["mountId", "name", "subgraphs"]);
	if (!Array.isArray(value.nodes) || !Array.isArray(value.edges))
		throw new TypeError("Local untrusted JS compute describe has an invalid shape.");
	budget.nodes += value.nodes.length;
	budget.edges += value.edges.length;
	if (budget.nodes > manifest.maxTopologyNodes || budget.edges > manifest.maxTopologyEdges)
		throw new TypeError("Local untrusted JS compute describe exceeds its bounds.");
	const nodes = value.nodes.map((node) => describeNode(node));
	const ids = new Set(nodes.map((node) => node.id));
	if (ids.size !== nodes.length)
		throw new TypeError("Local untrusted JS compute describe has duplicate node ids.");
	for (const node of nodes) {
		if (budget.nodeIds.has(node.id))
			throw new TypeError("Local untrusted JS compute describe has duplicate global node ids.");
		budget.nodeIds.add(node.id);
	}
	const expectedEdges = new Set<string>();
	for (const node of nodes) {
		for (const dep of node.deps) {
			if (!ids.has(dep))
				throw new TypeError("Local untrusted JS compute describe has an unknown dependency.");
			expectedEdges.add(`${dep}\n${node.id}`);
		}
	}
	const edges = value.edges.map((edge) => topologyEdge(edge));
	const observedEdges = new Set(edges.map((edge) => `${edge.from}\n${edge.to}`));
	if (
		observedEdges.size !== edges.length ||
		observedEdges.size !== expectedEdges.size ||
		[...observedEdges].some((edge) => !expectedEdges.has(edge))
	)
		throw new TypeError("Local untrusted JS compute describe edges disagree with node deps.");
	const out: DescribeSnapshot = { nodes, edges };
	if (depth === 0 && value.mountId !== undefined)
		throw new TypeError("Local untrusted JS compute root describe must not have a mount id.");
	if (depth > 0 && value.mountId === undefined)
		throw new TypeError("Local untrusted JS compute child describe requires a mount id.");
	if (value.mountId !== undefined) {
		safe(value.mountId, "local untrusted JS compute describe mount id");
		if (budget.mountIds.has(value.mountId))
			throw new TypeError("Local untrusted JS compute describe has duplicate mount ids.");
		budget.mountIds.add(value.mountId);
		out.mountId = value.mountId;
	}
	if (value.name !== undefined) {
		safe(value.name, "local untrusted JS compute describe name");
		out.name = value.name;
	}
	if (value.subgraphs !== undefined) {
		if (!Array.isArray(value.subgraphs))
			throw new TypeError("Local untrusted JS compute describe subgraphs must be an array.");
		out.subgraphs = value.subgraphs.map((entry) =>
			describeSnapshot(entry, manifest, budget, depth + 1),
		);
	}
	return Object.freeze(out);
}

function describeNode(value: unknown): DescribeSnapshot["nodes"][number] {
	exactOptionalKeys(
		value,
		["id", "factory", "deps", "status"],
		["name", "meta", "value", "version"],
	);
	const topology = topologyNode({
		id: value.id,
		factory: value.factory,
		deps: value.deps,
		...(value.name === undefined ? {} : { name: value.name }),
		...(value.meta === undefined ? {} : { meta: value.meta }),
	});
	if (
		!["sentinel", "pending", "dirty", "settled", "resolved", "completed", "errored"].includes(
			String(value.status),
		)
	)
		throw new TypeError("Local untrusted JS compute describe node status is invalid.");
	const out: DescribeSnapshot["nodes"][number] = {
		...topology,
		status: value.status as DescribeSnapshot["nodes"][number]["status"],
	};
	if (Object.hasOwn(value, "value"))
		out.value = cloneJson(value.value, "local untrusted JS compute describe node value");
	if (value.version !== undefined) out.version = nodeVersion(value.version);
	return Object.freeze(out);
}

function nodeVersion(value: unknown): NonNullable<DescribeSnapshot["nodes"][number]["version"]> {
	if (!plain(value))
		throw new TypeError("Local untrusted JS compute describe node version is invalid.");
	if (value.level === 0) {
		exactKeys(value, ["level", "counter"]);
		if (!Number.isSafeInteger(value.counter) || Number(value.counter) < 0)
			throw new TypeError("Local untrusted JS compute describe node version is invalid.");
		return Object.freeze({ level: 0, counter: Number(value.counter) });
	}
	exactKeys(value, ["level", "counter", "cid", "prev"]);
	if (
		value.level !== 1 ||
		!Number.isSafeInteger(value.counter) ||
		Number(value.counter) < 0 ||
		typeof value.cid !== "string" ||
		(value.prev !== null && typeof value.prev !== "string")
	)
		throw new TypeError("Local untrusted JS compute describe node version is invalid.");
	safe(value.cid, "local untrusted JS compute describe node version cid");
	if (value.prev !== null)
		safe(value.prev, "local untrusted JS compute describe node previous version cid");
	return Object.freeze({
		level: 1,
		counter: Number(value.counter),
		cid: value.cid,
		prev: value.prev,
	});
}

function exactKeys(
	value: unknown,
	keys: readonly string[],
): asserts value is Record<string, unknown> {
	if (!plain(value) || Object.keys(value).sort().join("\n") !== [...keys].sort().join("\n"))
		throw new TypeError("Local untrusted JS compute contract has an unexpected shape.");
}

function runtimeAttemptKey(value: { readonly runId: string; readonly attempt: number }): string {
	return compoundTupleKey("local-untrusted-js-compute-attempt", [
		value.runId,
		String(value.attempt),
	]);
}

function cancellationMatchesLocalAttempt(
	value: LocalUntrustedJsComputeCancellationAdmission,
	record: LocalUntrustedJsComputeActiveAttempt,
): boolean {
	try {
		exactKeys(value, [
			"kind",
			"admissionId",
			"cancellationId",
			"state",
			"runId",
			"adapterInputId",
			"requestId",
			"operationId",
			"routeId",
			"providerId",
			"executorId",
			"profileId",
			"runAdmissionId",
			"attempt",
			"epoch",
			"manifestFingerprint",
			"hostBindingDigest",
			"sourceRefs",
		]);
		for (const coordinate of [
			value.admissionId,
			value.cancellationId,
			value.runId,
			value.adapterInputId,
			value.requestId,
			value.operationId,
			value.routeId,
			value.providerId,
			value.executorId,
			value.profileId,
			value.runAdmissionId,
			value.epoch,
			value.manifestFingerprint,
		])
			safe(coordinate, "local untrusted JS compute cancellation coordinate");
		digest(value.hostBindingDigest, "local untrusted JS compute cancellation host binding");
		if (
			!Number.isSafeInteger(value.attempt) ||
			value.attempt < 1 ||
			!Array.isArray(value.sourceRefs) ||
			value.sourceRefs.length > 32 ||
			value.sourceRefs.some(
				(ref) =>
					!plain(ref) ||
					Object.keys(ref).sort().join("\n") !== ["id", "kind"].join("\n") ||
					typeof ref.kind !== "string" ||
					typeof ref.id !== "string",
			)
		)
			return false;
		for (const ref of value.sourceRefs) {
			safe(ref.kind, "local untrusted JS compute cancellation source ref kind");
			safe(ref.id, "local untrusted JS compute cancellation source ref id");
		}
	} catch {
		return false;
	}
	return (
		value.state === "admitted" &&
		value.runId === record.request.runId &&
		value.adapterInputId === record.input.adapterInputId &&
		value.requestId === record.input.requestId &&
		value.operationId === record.input.operationId &&
		value.routeId === record.input.routeId &&
		value.providerId === record.input.providerId &&
		value.executorId === record.input.executorId &&
		value.profileId === record.input.profileId &&
		value.runAdmissionId === record.admission.admissionId &&
		value.attempt === record.request.attempt &&
		value.epoch === record.args.epoch &&
		value.manifestFingerprint === record.manifest.fingerprint &&
		value.hostBindingDigest === record.readiness.hostBindingDigest
	);
}

function exactOptionalKeys(
	value: unknown,
	required: readonly string[],
	optional: readonly string[],
): asserts value is Record<string, unknown> {
	if (
		!plain(value) ||
		required.some((key) => !Object.hasOwn(value, key)) ||
		Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
	)
		throw new TypeError("Local untrusted JS compute contract has an unexpected shape.");
}

function plain(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function safe(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/.test(value))
		throw new TypeError(`Invalid ${label}.`);
}

function digest(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
		throw new TypeError(`Invalid ${label}.`);
}

function positive(value: unknown, label: string): asserts value is number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError(`Invalid ${label}.`);
}

function stringList(value: readonly string[], label: string): readonly string[] {
	if (!Array.isArray(value) || value.length > 64) throw new TypeError(`Invalid ${label}.`);
	const out = value.map((entry) => {
		safe(entry, label);
		return entry;
	});
	if (new Set(out).size !== out.length) throw new TypeError(`Duplicate ${label}.`);
	return Object.freeze(out);
}

function sameStrings(left: unknown, right: readonly string[]): boolean {
	return (
		Array.isArray(left) &&
		left.length === right.length &&
		left.every((item, index) => item === right[index])
	);
}

function jsonBytes(value: unknown, label: string): number {
	return new TextEncoder().encode(JSON.stringify(cloneJson(value, label))).byteLength;
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const crypto = globalThis.crypto;
	if (crypto?.subtle === undefined)
		throw new TypeError("Local untrusted JS compute SHA-256 authority is unavailable.");
	const digestBytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
	);
	return `sha256:${[...digestBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function cloneJson(
	value: unknown,
	label: string,
	seen = new WeakSet<object>(),
): LocalUntrustedJsJson {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError(`${label} must contain finite JSON values.`);
		return value;
	}
	if (typeof value !== "object") throw new TypeError(`${label} must be JSON data.`);
	if (seen.has(value)) throw new TypeError(`${label} must not contain cycles.`);
	seen.add(value);
	if (Array.isArray(value)) {
		const out = value.map((entry) => cloneJson(entry, label, seen));
		seen.delete(value);
		return Object.freeze(out);
	}
	if (!plain(value)) throw new TypeError(`${label} must contain only plain records.`);
	const out: Record<string, LocalUntrustedJsJson> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key))
			throw new TypeError(`${label} contains an invalid key.`);
		out[key] = cloneJson(entry, label, seen);
	}
	seen.delete(value);
	return Object.freeze(out);
}
