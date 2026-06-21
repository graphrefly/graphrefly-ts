import type { DataIssue } from "../data/index.js";
import type { CapacityPolicy, ReactiveOpt, RetentionPolicy } from "../graph/policies/types.js";
import type { Node } from "../node/node.js";
import type { AgentNeed, AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type {
	AgentOutputEnvelope,
	AgentRequestInput,
	AgentRequestStatusChanged,
	ExecutorOutcome,
	ExecutorOutcomeStatus,
	ExecutorProfile,
	ExecutorRoute,
	ExecutorUsage,
	SourceRef,
} from "./agent-runtime-types-core.js";

/**
 * Provider-neutral tool-call request input (D359). Concrete clients, secrets,
 * transports, and SDK handles stay in executor adapter bindings, not this fact.
 */
export interface ToolCallInput<TArguments = unknown> {
	readonly kind: "tool-call";
	readonly toolName: string;
	readonly operation?: string;
	readonly arguments?: TArguments;
	readonly argumentsRef?: string;
	readonly expectedOutput?: {
		readonly resultKind?: string;
		readonly schemaRef?: string;
	};
	readonly idempotency?: {
		readonly key?: string;
		readonly safeToRetry?: boolean;
	};
	readonly timeoutMs?: number;
	readonly subjectRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

/**
 * Tool provider family label for optional Layer C adapters (D359). Builtin,
 * MCP, CLI, and Composio providers stay executor/tool recipes, not WorkItem
 * core or protocol semantics.
 */
export type ToolProviderKind = "local-builtin" | "mcp" | "cli" | "composio" | (string & {});

export type ToolProviderSizeUnit =
	| "bytes"
	| "chars"
	| "tokens"
	| "items"
	| "events"
	| "lines"
	| (string & {});

/**
 * D293-style size-capacity limit material for Layer C tool providers (D360).
 * This is policy/evidence vocabulary only; enforcement remains adapter-owned.
 */
export interface ToolProviderSizeLimit {
	readonly unit: ToolProviderSizeUnit;
	readonly softLimit?: number;
	readonly hardLimit?: number;
	readonly window?: string;
	readonly perItem?: boolean;
	readonly perBatch?: boolean;
	readonly perArtifact?: boolean;
	readonly perStream?: boolean;
	readonly perRequest?: boolean;
	readonly perTool?: boolean;
	readonly policyScopeRefs?: readonly SourceRef[];
	readonly measurementSource?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderSizeCapacityPolicy {
	readonly limits: readonly ToolProviderSizeLimit[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderTimeoutPolicy {
	readonly timeoutMs?: number;
	readonly connectTimeoutMs?: number;
	readonly idleTimeoutMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderRedactionPolicy {
	readonly mode?: "none" | "summary" | "redact" | "ref-only" | (string & {});
	readonly sensitivity?: readonly string[];
	readonly redactKinds?: readonly string[];
	readonly summaryMaxChars?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderPathRule {
	readonly effect: "allow" | "deny" | "summary" | "ref-only" | (string & {});
	readonly path?: string;
	readonly glob?: string;
	readonly operation?: string;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderFilesystemPolicy {
	readonly cwd?: string;
	readonly pathRules?: readonly ToolProviderPathRule[];
	readonly allowRead?: boolean;
	readonly allowWrite?: boolean;
	readonly followSymlinks?: boolean;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderNetworkPolicy {
	readonly mode?: "disabled" | "allowlist" | "denylist" | "custom" | (string & {});
	readonly protocols?: readonly string[];
	readonly allowedHosts?: readonly string[];
	readonly deniedHosts?: readonly string[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderApprovalPolicy {
	readonly mode?: "auto" | "require" | "never" | "custom" | (string & {});
	readonly requiredForToolNames?: readonly string[];
	readonly requiredForOperations?: readonly string[];
	readonly approverRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderArtifactPolicy {
	readonly defaultDataMode?: "inline" | "summary" | "ref" | (string & {});
	readonly inlineLimits?: readonly ToolProviderSizeLimit[];
	readonly artifactKinds?: readonly string[];
	readonly requireDigest?: boolean;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

/**
 * Data-only execution policy fact for optional Layer C tool providers (D360).
 * It is admission/routing/audit/adapter-input material, not an enforcement
 * runtime, security boundary, provider SDK, client handle, or secret container.
 */
export interface ToolProviderExecutionPolicy {
	readonly kind: "tool-provider-execution-policy";
	readonly policyId: string;
	readonly providerId: string;
	readonly profileIds?: readonly string[];
	readonly toolNames?: readonly string[];
	readonly operations?: readonly string[];
	readonly sizeCapacity?: ToolProviderSizeCapacityPolicy;
	readonly timeout?: ToolProviderTimeoutPolicy;
	readonly redaction?: ToolProviderRedactionPolicy;
	readonly filesystem?: ToolProviderFilesystemPolicy;
	readonly network?: ToolProviderNetworkPolicy;
	readonly approval?: ToolProviderApprovalPolicy;
	readonly artifacts?: ToolProviderArtifactPolicy;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

/**
 * Graph-visible catalog entry for a tool exposed by an executor provider
 * (D359). Runtime clients and credentials remain private adapter state.
 */
export interface ToolProviderCatalogEntry {
	readonly kind: "tool-catalog-entry";
	readonly providerId: string;
	readonly toolName: string;
	readonly operation?: string;
	readonly inputKind: "tool-call";
	readonly profileId: string;
	readonly executorId: string;
	readonly resultKinds?: readonly string[];
	readonly schemaRefs?: readonly string[];
	readonly capabilities?: Record<string, unknown>;
	readonly limits?: Record<string, number>;
	readonly policyRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

/**
 * Graph-visible tool provider catalog/status surface (D359). This is passive
 * DATA for routing/profile selection and UI inspection, not a provider runtime.
 */
export interface ToolProviderCatalog {
	readonly kind: "tool-provider-catalog";
	readonly providerId: string;
	readonly providerKind: ToolProviderKind;
	readonly profiles: readonly ExecutorProfile[];
	readonly tools: readonly ToolProviderCatalogEntry[];
	readonly policies?: readonly ToolProviderExecutionPolicy[];
	readonly policyRefs?: readonly SourceRef[];
	readonly status?: "ready" | "unavailable" | "misconfigured";
	readonly issues?: readonly DataIssue[];
	readonly audit?: readonly AgentRuntimeAuditRecord[];
	readonly metadata?: Record<string, unknown>;
}

/**
 * Options for producing a local builtin tool-provider catalog (D359). Limits and
 * capabilities are declarative policy hints; execution remains adapter-owned.
 */
export interface LocalBuiltinToolProviderCatalogOptions {
	readonly providerId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly tools?: readonly Omit<
		ToolProviderCatalogEntry,
		"kind" | "providerId" | "inputKind" | "profileId" | "executorId"
	>[];
	readonly limits?: Record<string, number>;
	readonly capabilities?: Record<string, unknown>;
	readonly policies?: readonly ToolProviderExecutionPolicy[];
	readonly policyOverrides?: Partial<
		Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">
	>;
	readonly metadata?: Record<string, unknown>;
}

export type ToolProviderPolicyResolutionStatus =
	| "pending-route"
	| "resolved"
	| "missing-tool-call"
	| "missing-catalog"
	| "ambiguous-catalog"
	| "missing-tool"
	| "missing-policy"
	| "invalid-policy";

export interface ToolProviderPolicyResolution {
	readonly kind: "tool-provider-policy-resolution";
	readonly resolutionId: string;
	readonly status: ToolProviderPolicyResolutionStatus;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId?: string;
	readonly providerId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly toolName?: string;
	readonly operation?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderPolicyResolutionBundle {
	readonly resolutions: Node<ToolProviderPolicyResolution>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type ToolProviderAdapterInputStatus =
	| "ready"
	| Exclude<ToolProviderPolicyResolutionStatus, "resolved">;

/**
 * Data-only adapter input projection for optional Layer C tool providers
 * (D359/D360). It packages already-routed AgentRequest/tool-call material plus
 * selected D360 policy facts for an adapter boundary, but it never executes a
 * tool and never carries clients, transports, credentials, subprocesses, SDK
 * handles, or OAuth state.
 */
export interface ToolProviderAdapterInput<TArguments = unknown> {
	readonly kind: "tool-provider-adapter-input";
	readonly adapterInputId: string;
	readonly status: ToolProviderAdapterInputStatus;
	readonly requestId: string;
	readonly operationId: string;
	readonly effectRunId?: string;
	readonly agentRunId?: string;
	readonly routeId?: string;
	readonly providerId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly toolName?: string;
	readonly operation?: string;
	readonly input?: AgentRequestInput<ToolCallInput<TArguments>>;
	readonly toolCall?: ToolCallInput<TArguments>;
	readonly route?: ExecutorRoute;
	readonly tool?: ToolProviderCatalogEntry;
	readonly policies?: readonly ToolProviderExecutionPolicy[];
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderAdapterInputBundle {
	readonly inputs: Node<ToolProviderAdapterInput>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type ToolProviderAdapterRunResult<T = unknown> =
	| {
			readonly kind: "result";
			readonly result: AgentOutputEnvelope<T>;
			readonly evidenceRefs?: readonly SourceRef[];
			readonly issues?: readonly DataIssue[];
			readonly usage?: ExecutorUsage;
			readonly occurredAtMs?: number;
			readonly metadata?: Record<string, unknown>;
	  }
	| {
			readonly kind: "failure";
			readonly error: DataIssue;
			readonly retryable?: boolean;
			readonly evidenceRefs?: readonly SourceRef[];
			readonly issues?: readonly DataIssue[];
			readonly usage?: ExecutorUsage;
			readonly occurredAtMs?: number;
			readonly metadata?: Record<string, unknown>;
	  }
	| {
			readonly kind: "canceled";
			readonly reason?: string;
			readonly evidenceRefs?: readonly SourceRef[];
			readonly issues?: readonly DataIssue[];
			readonly usage?: ExecutorUsage;
			readonly occurredAtMs?: number;
			readonly metadata?: Record<string, unknown>;
	  }
	| {
			readonly kind: "timeout";
			readonly timeoutMs?: number;
			readonly retryable?: boolean;
			readonly evidenceRefs?: readonly SourceRef[];
			readonly issues?: readonly DataIssue[];
			readonly usage?: ExecutorUsage;
			readonly occurredAtMs?: number;
			readonly metadata?: Record<string, unknown>;
	  }
	| {
			readonly kind: "blocked";
			readonly needs: readonly AgentNeed[];
			readonly evidenceRefs?: readonly SourceRef[];
			readonly issues?: readonly DataIssue[];
			readonly usage?: ExecutorUsage;
			readonly occurredAtMs?: number;
			readonly metadata?: Record<string, unknown>;
	  };

export interface ToolProviderAdapterRunContext {
	readonly runId?: string;
	readonly attempt: number;
	readonly reason?: ToolProviderAdapterRunReason;
	readonly sourceRefs: readonly SourceRef[];
	readonly now?: () => number;
}

export type ToolProviderAdapterRunReason = "initial" | "retry" | "manual" | (string & {});

/**
 * Graph-visible D362 execution lifecycle request. Attempts stay out of
 * ToolProviderAdapterInput identity; this fact is the visible run coordinate.
 */
export interface ToolProviderAdapterRunRequested {
	readonly kind: "tool-provider-adapter-run-requested";
	readonly runId: string;
	readonly adapterInputId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId?: string;
	readonly providerId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly attempt: number;
	readonly reason: ToolProviderAdapterRunReason;
	readonly retryOfOutcomeId?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
	readonly requestedAtMs?: number;
}

export interface ToolProviderAdapterRunStatus {
	readonly kind: "tool-provider-adapter-run-status";
	readonly runId: string;
	readonly adapterInputId: string;
	readonly requestId?: string;
	readonly operationId?: string;
	readonly status:
		| "requested"
		| "missing-request"
		| "missing-input"
		| "stale-request"
		| "mismatched-request"
		| "retention-gap"
		| "started"
		| ExecutorOutcomeStatus;
	readonly attempt?: number;
	readonly outcomeId?: string;
	readonly issues?: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderAdapterRunBundle {
	readonly requests: Node<ToolProviderAdapterRunRequested>;
	readonly status: Node<ToolProviderAdapterRunStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type ToolProviderRunAdmissionOutcome = "admit" | "block" | "defer";
export type ToolProviderRunAdmissionState = "admitted" | "blocked" | "deferred" | "waiting";

export interface ToolProviderRunAdmissionProposal {
	readonly kind: "tool-provider-run-admission-proposal";
	readonly proposalId: string;
	readonly runId: string;
	readonly adapterInputId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId?: string;
	readonly providerId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly toolName?: string;
	readonly operation?: string;
	readonly attempt: number;
	readonly reason: ToolProviderAdapterRunReason;
	readonly approvalMode: "auto" | "require" | "never" | "custom" | (string & {});
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly needs?: readonly AgentNeed[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderRunAdmissionDecision {
	readonly kind: "tool-provider-run-admission-decision";
	readonly decisionId: string;
	readonly proposalId: string;
	readonly admissionId: string;
	readonly outcome: ToolProviderRunAdmissionOutcome;
	readonly approvedRunId?: string;
	readonly reason?: string;
	readonly decidedByRef?: SourceRef;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderRunAdmission {
	readonly kind: "tool-provider-run-admission";
	readonly admissionId: string;
	readonly proposalId: string;
	readonly runId: string;
	readonly adapterInputId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly state: ToolProviderRunAdmissionState;
	readonly decisionId?: string;
	readonly approvedRunId?: string;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderRunAdmissionStatus {
	readonly kind: "tool-provider-run-admission-status";
	readonly proposalId: string;
	readonly runId: string;
	readonly adapterInputId: string;
	readonly requestId?: string;
	readonly operationId?: string;
	readonly state: ToolProviderRunAdmissionState | "issue";
	readonly admissionId?: string;
	readonly decisionId?: string;
	readonly approvedRunId?: string;
	readonly issues?: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ToolProviderRunAdmissionViews {
	readonly admissionsByProposal: ReadonlyMap<string, ToolProviderRunAdmission>;
	readonly admissionsByRun: ReadonlyMap<string, readonly ToolProviderRunAdmission[]>;
	readonly proposalsByRun: ReadonlyMap<string, readonly ToolProviderRunAdmissionProposal[]>;
}

export interface ToolProviderRunAdmissionBundle {
	readonly proposals: Node<ToolProviderRunAdmissionProposal>;
	readonly admissions: Node<ToolProviderRunAdmission>;
	readonly approvedRunRequests: Node<ToolProviderAdapterRunRequested>;
	readonly status: Node<ToolProviderRunAdmissionStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<ToolProviderRunAdmissionViews>;
}

export interface ToolProviderPublicTextPolicy {
	readonly maxMessageChars?: number;
	readonly maxSummaryChars?: number;
	readonly maxReasonChars?: number;
	readonly maxMetadataStringChars?: number;
}

export type ToolProviderAdapterRuntimeRetentionIndex =
	| "adapterInputs"
	| "runRequests"
	| "executions"
	| "runStatuses"
	| "runIssues"
	| "retentionEvidence";

export type ToolProviderAdapterRuntimeRetentionOrder = "fifo";

export interface ToolProviderAdapterInputRetentionEntry {
	readonly key: string;
	readonly sequence: number;
	readonly insertedAtMs?: number;
	readonly adapterInputId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId?: string;
	readonly providerId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly status?: ToolProviderAdapterInputStatus;
}

export interface ToolProviderAdapterRunRequestRetentionEntry {
	readonly key: string;
	readonly sequence: number;
	readonly requestedAtMs?: number;
	readonly adapterInputId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId?: string;
	readonly providerId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly reason?: ToolProviderAdapterRunReason;
}

export interface ToolProviderAdapterExecutionRetentionEntry {
	readonly key: string;
	readonly sequence: number;
	readonly occurredAtMs?: number;
	readonly adapterInputId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId?: string;
	readonly providerId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly outcomeId?: string;
	readonly status?: ExecutorOutcomeStatus | "started";
	readonly reason?: ToolProviderAdapterRunReason;
}

export interface ToolProviderAdapterRunStatusRetentionEntry {
	readonly key: string;
	readonly sequence: number;
	readonly occurredAtMs?: number;
	readonly adapterInputId: string;
	readonly runId: string;
	readonly attempt?: number;
	readonly requestId?: string;
	readonly operationId?: string;
	readonly status: ToolProviderAdapterRunStatus["status"];
	readonly outcomeId?: string;
	readonly issueCode?: string;
}

export interface ToolProviderAdapterRunIssueRetentionEntry {
	readonly key: string;
	readonly sequence: number;
	readonly occurredAtMs?: number;
	readonly adapterInputId?: string;
	readonly runId?: string;
	readonly attempt?: number;
	readonly requestId?: string;
	readonly operationId?: string;
	readonly issueCode: string;
	readonly severity?: DataIssue["severity"];
	readonly subjectId?: string;
}

export interface ToolProviderAdapterRuntimeRetentionEvidenceEntry {
	readonly key: string;
	readonly sequence: number;
	readonly occurredAtMs?: number;
	readonly adapterInputId: string;
	readonly evidenceKind: "adapter-input-trimmed" | "execution-high-water";
	readonly attemptHighWater?: number;
	readonly reason: "adapter-input-retention" | "execution-proof-retention";
}

export type ToolProviderAdapterRuntimeIndexRetentionPolicy<Entry> =
	| CapacityPolicy<ToolProviderAdapterRuntimeRetentionOrder>
	| (RetentionPolicy<Entry> & { readonly maxSize: ReactiveOpt<number> });

export interface ToolProviderAdapterRuntimeRetentionPolicy {
	readonly adapterInputs?: ToolProviderAdapterRuntimeIndexRetentionPolicy<ToolProviderAdapterInputRetentionEntry>;
	readonly runRequests?: ToolProviderAdapterRuntimeIndexRetentionPolicy<ToolProviderAdapterRunRequestRetentionEntry>;
	readonly executions?: ToolProviderAdapterRuntimeIndexRetentionPolicy<ToolProviderAdapterExecutionRetentionEntry>;
	readonly runStatuses?: ToolProviderAdapterRuntimeIndexRetentionPolicy<ToolProviderAdapterRunStatusRetentionEntry>;
	readonly runIssues?: ToolProviderAdapterRuntimeIndexRetentionPolicy<ToolProviderAdapterRunIssueRetentionEntry>;
	readonly retentionEvidence?: ToolProviderAdapterRuntimeIndexRetentionPolicy<ToolProviderAdapterRuntimeRetentionEvidenceEntry>;
}

export type ToolProviderAdapterRuntimeStatusKind =
	| "retention-trimmed"
	| "retention-gap"
	| "invalid-retention-policy";

export interface ToolProviderAdapterRuntimeStatus {
	readonly kind: "tool-provider-adapter-runtime-status";
	readonly status: ToolProviderAdapterRuntimeStatusKind;
	readonly index?: ToolProviderAdapterRuntimeRetentionIndex;
	readonly key?: string;
	readonly adapterInputId?: string;
	readonly runId?: string;
	readonly attempt?: number;
	readonly issueCode?: string;
	readonly occurredAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

/**
 * Runtime-private adapter binding for D361. Bindings may close over clients,
 * credentials, subprocess access, transports, SDK objects, or environment
 * handles, but the binding itself must never be graph DATA or WorkItem core
 * material.
 */
export interface ToolProviderAdapterBinding<TArguments = unknown, TResult = unknown> {
	readonly providerId: string;
	run(
		input: ToolProviderAdapterInput<TArguments>,
		ctx: ToolProviderAdapterRunContext,
	): ToolProviderAdapterRunResult<TResult>;
}

export interface ToolProviderAdapterRuntimeOptions<TArguments = unknown, TResult = unknown> {
	readonly name?: string;
	readonly inputs: Node<ToolProviderAdapterInput<TArguments>>;
	readonly runRequests?: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly bindings:
		| readonly ToolProviderAdapterBinding<TArguments, TResult>[]
		| ReadonlyMap<string, ToolProviderAdapterBinding<TArguments, TResult>>;
	readonly autoRunReadyInputs?: boolean;
	readonly retention?: ToolProviderAdapterRuntimeRetentionPolicy;
	readonly now?: () => number;
	readonly publicText?: ToolProviderPublicTextPolicy;
}

export interface ToolProviderAdapterRuntimeHandle {
	readonly runRequests: Node<ToolProviderAdapterRunRequested>;
	readonly runStatus: Node<ToolProviderAdapterRunStatus>;
	readonly runtimeStatus: Node<ToolProviderAdapterRuntimeStatus>;
	readonly outcomes: Node<ExecutorOutcome>;
	readonly status: Node<AgentRequestStatusChanged>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	dispose(): void;
}

/**
 * Audience selector for bounded ExecutorOutcome projections (D359).
 */
export type ExecutorOutcomeViewAudience = "agent-observation" | "ui" | "diagnostic" | "audit";

/**
 * View policy for deriving bounded, audience-specific ExecutorOutcome summaries
 * (D359/D270/D293) without inlining large/raw provider material.
 */
export interface ExecutorOutcomeViewPolicy {
	readonly audience?: ExecutorOutcomeViewAudience;
	readonly maxSummaryChars?: number;
	readonly includeIssues?: boolean;
	readonly includeUsage?: boolean;
	readonly includeMetadata?: boolean;
}

/**
 * Bounded projection of ExecutorOutcome for agent, UI, diagnostic, or audit
 * consumers (D359). Large/raw material stays behind refs.
 */
export interface ExecutorOutcomeView {
	readonly kind: "executor-outcome-view";
	readonly viewId: string;
	readonly audience: ExecutorOutcomeViewAudience;
	readonly outcomeId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly status: ExecutorOutcomeStatus;
	readonly summary: string;
	readonly summaryTruncated?: boolean;
	readonly summaryChars?: number;
	readonly summaryLimitChars?: number;
	readonly errorKind?: string;
	readonly retryable?: boolean;
	readonly nextActions?: readonly string[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly materialRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly usage?: ExecutorUsage;
	readonly metadata?: Record<string, unknown>;
}

/**
 * Output bundle for ExecutorOutcome view projectors (D359).
 */
export interface ExecutorOutcomeViewBundle {
	readonly views: Node<ExecutorOutcomeView>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}
