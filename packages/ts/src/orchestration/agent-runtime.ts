import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";

export interface SourceRef {
	readonly kind: string;
	readonly id: string;
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestInput<T = unknown> {
	readonly inputId: string;
	readonly inputKind: string;
	readonly dataMode?: "ref" | "summary" | "inline";
	readonly ref?: string;
	readonly summary?: string;
	readonly value?: T;
	readonly schemaRef?: string;
	readonly subjectRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface EffectRunGoal<TInput = unknown> {
	readonly kind: string;
	readonly summary?: string;
	readonly detailRef?: string;
	readonly input?: AgentRequestInput<TInput>;
	readonly metadata?: Record<string, unknown>;
}

export interface EffectRunLimits {
	readonly maxSteps?: number;
	readonly maxRequests?: number;
	readonly maxAttemptsPerOperation?: number;
	readonly maxPendingRequests?: number;
	readonly maxCostUsd?: number;
	readonly timeoutMs?: number;
}

export interface EffectRun<TInput = unknown> {
	readonly kind: "effect-run";
	readonly effectRunId: string;
	readonly agentRunId?: string;
	readonly subjectRefs?: readonly SourceRef[];
	readonly goal: EffectRunGoal<TInput>;
	readonly sourceRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly limits?: EffectRunLimits;
	readonly createdBy?: string;
	readonly createdAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface EffectRunOptions<TInput = unknown> {
	readonly effectRunId: string;
	readonly agentRunId?: string;
	readonly subjectRefs?: readonly SourceRef[];
	readonly goal: EffectRunGoal<TInput>;
	readonly sourceRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly limits?: EffectRunLimits;
	readonly createdBy?: string;
	readonly createdAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export function effectRun<TInput = unknown>(opts: EffectRunOptions<TInput>): EffectRun<TInput> {
	return {
		kind: "effect-run",
		effectRunId: opts.effectRunId,
		agentRunId: opts.agentRunId,
		subjectRefs: opts.subjectRefs,
		goal: opts.goal,
		sourceRefs: opts.sourceRefs,
		policyRefs: opts.policyRefs,
		limits: opts.limits,
		createdBy: opts.createdBy,
		createdAtMs: opts.createdAtMs,
		metadata: opts.metadata,
	};
}

export type AgentRequestKind = "context" | "prompt" | "executor";

export interface AgentRequestProposal<TPayload = unknown> {
	readonly kind: "proposal";
	readonly proposalId: string;
	readonly effectRunId: string;
	readonly agentRunId?: string;
	readonly parentRequestId?: string;
	readonly sourceDecisionId?: string;
	readonly requestKind: AgentRequestKind;
	readonly required?: boolean;
	readonly subjectId?: string;
	readonly input?: AgentRequestInput<TPayload>;
	readonly payload?: TPayload;
	readonly reason?: string;
	readonly evidenceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestAdmitted {
	readonly kind: "admitted";
	readonly proposalId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly effectRunId: string;
	readonly agentRunId?: string;
	readonly admittedAtMs?: number;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestRejected {
	readonly kind: "rejected";
	readonly proposalId: string;
	readonly effectRunId: string;
	readonly issue: DataIssue;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestDeferred {
	readonly kind: "deferred";
	readonly proposalId: string;
	readonly effectRunId: string;
	readonly reason?: string;
	readonly untilRef?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestMerged {
	readonly kind: "merged";
	readonly proposalId: string;
	readonly effectRunId: string;
	readonly targetRequestId: string;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestIssued<TPayload = unknown> {
	readonly kind: "issued";
	readonly requestId: string;
	readonly operationId: string;
	readonly effectRunId: string;
	readonly agentRunId?: string;
	readonly proposalId?: string;
	readonly parentRequestId?: string;
	readonly requestKind: AgentRequestKind;
	readonly required: boolean;
	readonly input?: AgentRequestInput<TPayload>;
	readonly payload?: TPayload;
	readonly issuedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type AgentRequestStatus =
	| "proposed"
	| "admitted"
	| "rejected"
	| "deferred"
	| "merged"
	| "issued"
	| "awaiting-context"
	| "awaiting-prompt"
	| "awaiting-route"
	| "awaiting-provider"
	| "in-flight"
	| "completed"
	| "failed"
	| "blocked"
	| "canceled"
	| "timeout"
	| "waived"
	| "retry-exhausted";

export interface AgentRequestStatusChanged {
	readonly kind: "status";
	readonly requestId: string;
	readonly operationId?: string;
	readonly effectRunId: string;
	readonly status: AgentRequestStatus;
	readonly sourceRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export type AgentRequestFact<TPayload = unknown> =
	| AgentRequestProposal<TPayload>
	| AgentRequestAdmitted
	| AgentRequestRejected
	| AgentRequestDeferred
	| AgentRequestMerged
	| AgentRequestIssued<TPayload>
	| AgentRequestStatusChanged;

export interface AgentRequestViews {
	readonly requestsById: ReadonlyMap<string, AgentRequestIssued>;
	readonly requestsByEffectRun: ReadonlyMap<string, readonly string[]>;
	readonly statusByRequest: ReadonlyMap<string, AgentRequestStatusChanged>;
	readonly pending: readonly AgentRequestIssued[];
	readonly awaitingProvider: readonly AgentRequestIssued[];
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgentRuntimeAuditRecord[];
}

export interface AgentRequestLedgerBundle {
	readonly views: Node<AgentRequestViews>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export interface ExecutorProfile {
	readonly profileId: string;
	readonly executorId: string;
	readonly kind: "llm" | "tool" | "human" | "agent";
	readonly acceptedInputKinds?: readonly string[];
	readonly acceptedSchemaRefs?: readonly string[];
	readonly acceptedResultKinds?: readonly string[];
	readonly capabilities?: Record<string, unknown>;
	readonly limits?: Record<string, number>;
	readonly policyRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ExecutorRoute {
	readonly kind: "executor-route";
	readonly routeId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly inputId?: string;
	readonly inputKind?: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly allowedParams?: Record<string, unknown>;
	readonly reason?: string;
	readonly evidenceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type ExecutorOutcomeStatus = "result" | "failure" | "canceled" | "timeout" | "blocked";

export interface ExecutorUsage {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cacheHitTokens?: number;
	readonly cacheMissTokens?: number;
	readonly cacheWriteTokens?: number;
	readonly cacheMode?: string;
	readonly costUsd?: number;
	readonly latencyMs?: number;
}

export interface ExecutorOutcomeBase {
	readonly kind: ExecutorOutcomeStatus;
	readonly outcomeId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly attempt: number;
	readonly inputId?: string;
	readonly inputKind?: string;
	readonly occurredAtMs?: number;
	readonly evidenceRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly usage?: ExecutorUsage;
	readonly metadata?: Record<string, unknown>;
}

export interface AgentOutputEnvelope<T = unknown> {
	readonly kind: string;
	readonly value?: T;
	readonly refs?: readonly SourceRef[];
	readonly summary?: string;
	readonly metadata?: Record<string, unknown>;
}

export type ExecutorOutcome<T = unknown> =
	| (ExecutorOutcomeBase & { readonly kind: "result"; readonly result: AgentOutputEnvelope<T> })
	| (ExecutorOutcomeBase & {
			readonly kind: "failure";
			readonly error: DataIssue;
			readonly retryable?: boolean;
	  })
	| (ExecutorOutcomeBase & { readonly kind: "canceled"; readonly reason?: string })
	| (ExecutorOutcomeBase & {
			readonly kind: "timeout";
			readonly timeoutMs?: number;
			readonly retryable?: boolean;
	  })
	| (ExecutorOutcomeBase & {
			readonly kind: "blocked";
			readonly needs: readonly AgentNeed[];
	  });

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
	readonly attempt: number;
	readonly sourceRefs: readonly SourceRef[];
	readonly now?: () => number;
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
	): ToolProviderAdapterRunResult<TResult> | PromiseLike<ToolProviderAdapterRunResult<TResult>>;
}

export interface ToolProviderAdapterRuntimeOptions<TArguments = unknown, TResult = unknown> {
	readonly name?: string;
	readonly inputs: Node<ToolProviderAdapterInput<TArguments>>;
	readonly bindings:
		| readonly ToolProviderAdapterBinding<TArguments, TResult>[]
		| ReadonlyMap<string, ToolProviderAdapterBinding<TArguments, TResult>>;
	readonly attempt?: number;
	readonly dedupeKey?: (input: ToolProviderAdapterInput<TArguments>) => string;
	readonly now?: () => number;
}

export interface ToolProviderAdapterRuntimeHandle {
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

export interface ContextContribution {
	readonly kind: "context-contribution";
	readonly contributionId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly status: "ready" | "pending" | "issue";
	readonly frameId?: string;
	readonly issues?: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface PromptBundle {
	readonly kind: "prompt-bundle";
	readonly promptId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly status: "ready" | "partial" | "issue";
	readonly sourceFrameIds?: readonly string[];
	readonly issues?: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestSatisfactionBundle {
	readonly status: Node<AgentRequestStatusChanged>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type AgentDecisionKind = "continue" | "final" | "blocked";

export interface AgentNeed {
	readonly kind: string;
	readonly message?: string;
	readonly refs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentDecisionBase {
	readonly kind: AgentDecisionKind;
	readonly decisionId: string;
	readonly effectRunId: string;
	readonly agentRunId: string;
	readonly source: {
		readonly requestId: string;
		readonly operationId: string;
		readonly outcomeId: string;
	};
	readonly reason?: string;
	readonly confidence?: number;
	readonly evidenceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentDecisionContinue extends AgentDecisionBase {
	readonly kind: "continue";
	readonly next: readonly AgentRequestProposal[];
}

export interface AgentDecisionFinal extends AgentDecisionBase {
	readonly kind: "final";
	readonly output: AgentOutputEnvelope;
	readonly summary?: string;
}

export interface AgentDecisionBlocked extends AgentDecisionBase {
	readonly kind: "blocked";
	readonly needs: readonly AgentNeed[];
}

export type AgentDecision = AgentDecisionContinue | AgentDecisionFinal | AgentDecisionBlocked;

export interface StructuredAgentDecisionEnvelope {
	readonly kind: "agent-decision";
	readonly decision: AgentDecision;
	readonly schemaRef: string;
	readonly sourceRefs?: readonly SourceRef[];
}

export interface StructuredAgentDecisionInterpreterBundle {
	readonly decisions: Node<AgentDecision>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type EffectRunResultStatus =
	| "completed"
	| "failed"
	| "blocked"
	| "canceled"
	| "timeout"
	| "waived";

export interface EffectRunResultBase {
	readonly kind: "effect-run-result";
	readonly resultId: string;
	readonly status: EffectRunResultStatus;
	readonly effectRunId: string;
	readonly subjectRefs?: readonly SourceRef[];
	readonly operationId?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly auditRefs?: readonly string[];
	readonly completedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export type EffectRunResult =
	| (EffectRunResultBase & { readonly status: "completed"; readonly output: AgentOutputEnvelope })
	| (EffectRunResultBase & { readonly status: "failed"; readonly error: DataIssue })
	| (EffectRunResultBase & { readonly status: "blocked"; readonly needs: readonly AgentNeed[] })
	| (EffectRunResultBase & { readonly status: "canceled"; readonly reason?: string })
	| (EffectRunResultBase & { readonly status: "timeout"; readonly timeoutMs?: number })
	| (EffectRunResultBase & { readonly status: "waived"; readonly reason?: string });

export interface EffectRunCompletionBundle {
	readonly results: Node<EffectRunResult>;
	readonly status: Node<EffectRunCompletionStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export interface EffectRunCompletionStatus {
	readonly effectRunId: string;
	readonly state:
		| "pending"
		| "completed"
		| "failed"
		| "blocked"
		| "canceled"
		| "timeout"
		| "waived";
	readonly requiredPending: readonly string[];
	readonly requiredTerminal: readonly string[];
	readonly sourceRefs?: readonly SourceRef[];
}

export interface AgentRuntimeAuditRecord {
	readonly id: string;
	readonly kind: string;
	readonly subjectId?: string;
	readonly message?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly issueCode?: string;
	readonly metadata?: Record<string, unknown>;
}

interface RequestSatisfactionState {
	requests: Map<string, AgentRequestIssued>;
	profiles: Map<string, ExecutorProfile>;
	routes: Map<string, ExecutorRoute>;
	outcomes: Map<string, ExecutorOutcome>;
	contexts: Map<string, ContextContribution>;
	prompts: Map<string, PromptBundle>;
	compatibleRoutesByRouteId: Map<string, ExecutorRoute>;
	terminalRequests: Set<string>;
	acceptedTerminalFactIds: Set<string>;
	issueKeys: Set<string>;
	statusKeys: Set<string>;
	issueSeq: number;
	auditSeq: number;
}

export function agentRequestProposalFromDecision(
	decision: AgentDecisionContinue,
	proposal: Omit<AgentRequestProposal, "kind" | "effectRunId" | "agentRunId" | "sourceDecisionId">,
): AgentRequestProposal {
	return {
		kind: "proposal",
		...proposal,
		effectRunId: decision.effectRunId,
		agentRunId: decision.agentRunId,
		sourceDecisionId: decision.decisionId,
		evidenceRefs: proposal.evidenceRefs ?? decision.evidenceRefs,
	};
}

export function admitAgentRequestProposal(
	proposal: AgentRequestProposal,
	opts: {
		readonly requestId: string;
		readonly operationId: string;
		readonly admittedAtMs?: number;
		readonly reason?: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	},
): AgentRequestAdmitted {
	return {
		kind: "admitted",
		proposalId: proposal.proposalId,
		requestId: opts.requestId,
		operationId: opts.operationId,
		effectRunId: proposal.effectRunId,
		agentRunId: proposal.agentRunId,
		admittedAtMs: opts.admittedAtMs,
		reason: opts.reason,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

export function issueAgentRequest(
	proposal: AgentRequestProposal,
	admission: AgentRequestAdmitted,
	opts: { readonly issuedAtMs?: number; readonly sourceRefs?: readonly SourceRef[] } = {},
): AgentRequestIssued {
	return {
		kind: "issued",
		requestId: admission.requestId,
		operationId: admission.operationId,
		effectRunId: admission.effectRunId,
		agentRunId: admission.agentRunId,
		proposalId: proposal.proposalId,
		parentRequestId: proposal.parentRequestId,
		requestKind: proposal.requestKind,
		required: proposal.required ?? true,
		input: proposal.input,
		payload: proposal.payload,
		issuedAtMs: opts.issuedAtMs,
		sourceRefs: opts.sourceRefs ?? admission.sourceRefs,
		metadata: proposal.metadata,
	};
}

export function agentRequestLedgerViews(
	graph: Graph,
	facts: Node<AgentRequestFact>,
	opts: { readonly name?: string } = {},
): AgentRequestLedgerBundle {
	const name = opts.name ?? "agentRequests";
	const views = graph.node<AgentRequestViews>(
		[facts],
		(ctx) => {
			const prev = ctx.state.get<AgentRequestViewsState>() ?? emptyAgentRequestViewsState();
			const next = cloneAgentRequestViewsState(prev);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact;
				reduceAgentRequestViews(next, fact);
			}
			ctx.state.set(next);
			ctx.down([["DATA", freezeAgentRequestViews(next)]]);
		},
		{ name: `${name}/views`, factory: "agentRequestLedgerViews" },
	);
	const issues = graph.node<DataIssue>(
		[facts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "rejected") ctx.down([["DATA", fact.issue]]);
				if (fact.kind === "status") {
					for (const issue of fact.issues ?? []) ctx.down([["DATA", issue]]);
				}
			}
		},
		{ name: `${name}/issues`, factory: "agentRequestLedgerIssues" },
	);
	const audit = graph.node<AgentRuntimeAuditRecord>(
		[facts],
		(ctx) => {
			let seq = ctx.state.get<number>() ?? 0;
			for (const raw of depBatch(ctx, 0) ?? []) {
				seq += 1;
				const fact = raw as AgentRequestFact;
				ctx.down([
					[
						"DATA",
						{
							id: `${name}:ledger:${seq}`,
							kind: `agent-request-${fact.kind}`,
							subjectId: "requestId" in fact ? fact.requestId : fact.proposalId,
						} satisfies AgentRuntimeAuditRecord,
					],
				]);
			}
			ctx.state.set(seq);
		},
		{ name: `${name}/audit`, factory: "agentRequestLedgerAudit" },
	);
	return { views, issues, audit };
}

export function requestSatisfactionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly requestFacts: Node<AgentRequestFact>;
		readonly executorProfiles?: readonly Node<ExecutorProfile>[];
		readonly executorRoutes?: readonly Node<ExecutorRoute>[];
		readonly executorOutcomes?: readonly Node<ExecutorOutcome>[];
		readonly contextContributions?: readonly Node<ContextContribution>[];
		readonly promptBundles?: readonly Node<PromptBundle>[];
	},
): AgentRequestSatisfactionBundle {
	const name = opts.name ?? "requestSatisfaction";
	const profileDeps = opts.executorProfiles ?? [];
	const routeDeps = opts.executorRoutes ?? [];
	const outcomeDeps = opts.executorOutcomes ?? [];
	const contextDeps = opts.contextContributions ?? [];
	const promptDeps = opts.promptBundles ?? [];
	const deps = [
		opts.requestFacts,
		...profileDeps,
		...routeDeps,
		...outcomeDeps,
		...contextDeps,
		...promptDeps,
	];
	const profileStart = 1;
	const routeStart = profileStart + profileDeps.length;
	const outcomeStart = routeStart + routeDeps.length;
	const contextStart = outcomeStart + outcomeDeps.length;
	const promptStart = contextStart + contextDeps.length;
	const runtime = graph.node<AgentRequestSatisfactionFact>(
		deps,
		(ctx) => {
			const state = ctx.state.get<RequestSatisfactionState>() ?? {
				requests: new Map<string, AgentRequestIssued>(),
				profiles: new Map<string, ExecutorProfile>(),
				routes: new Map<string, ExecutorRoute>(),
				outcomes: new Map<string, ExecutorOutcome>(),
				contexts: new Map<string, ContextContribution>(),
				prompts: new Map<string, PromptBundle>(),
				compatibleRoutesByRouteId: new Map<string, ExecutorRoute>(),
				terminalRequests: new Set<string>(),
				acceptedTerminalFactIds: new Set<string>(),
				issueKeys: new Set<string>(),
				statusKeys: new Set<string>(),
				issueSeq: 0,
				auditSeq: 0,
			};
			for (const fact of depBatch(ctx, 0) ?? []) {
				if ((fact as AgentRequestFact).kind === "issued") {
					const request = fact as AgentRequestIssued;
					state.requests.set(request.requestId, request);
					emitStatus(ctx, state, request, initialRequestStatus(request), [
						ref("agent-request", request.requestId),
					]);
				}
			}
			forEachDepBatch(ctx, profileStart, profileDeps.length, (raw) => {
				const profile = raw as ExecutorProfile;
				state.profiles.set(profile.profileId, profile);
			});
			forEachDepBatch(ctx, routeStart, routeDeps.length, (raw) => {
				const route = raw as ExecutorRoute;
				state.routes.set(route.routeId, route);
			});
			forEachDepBatch(ctx, outcomeStart, outcomeDeps.length, (raw) => {
				const outcome = raw as ExecutorOutcome;
				state.outcomes.set(outcome.outcomeId, outcome);
			});
			forEachDepBatch(ctx, contextStart, contextDeps.length, (raw) => {
				const contribution = raw as ContextContribution;
				state.contexts.set(contribution.contributionId, contribution);
			});
			forEachDepBatch(ctx, promptStart, promptDeps.length, (raw) => {
				const prompt = raw as PromptBundle;
				state.prompts.set(prompt.promptId, prompt);
			});
			evaluateRequestSatisfaction(ctx, state);
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "requestSatisfactionProjector" },
	);
	const status = graph.node<AgentRequestStatusChanged>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as AgentRequestSatisfactionFact;
				if (typed.kind === "status") ctx.down([["DATA", typed.status]]);
			}
		},
		{ name: `${name}/status`, factory: "requestSatisfactionStatus" },
	);
	const issues = graph.node<DataIssue>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as AgentRequestSatisfactionFact;
				if (typed.kind === "issue") ctx.down([["DATA", typed.issue]]);
			}
		},
		{ name: `${name}/issues`, factory: "requestSatisfactionIssues" },
	);
	const audit = graph.node<AgentRuntimeAuditRecord>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as AgentRequestSatisfactionFact;
				if (typed.kind === "audit") ctx.down([["DATA", typed.audit]]);
			}
		},
		{ name: `${name}/audit`, factory: "requestSatisfactionAudit" },
	);
	return { status, issues, audit };
}

export function localBuiltinToolProviderCatalog(
	opts: LocalBuiltinToolProviderCatalogOptions = {},
): ToolProviderCatalog {
	const providerId = opts.providerId ?? "local-builtin";
	const executorId = opts.executorId ?? `${providerId}:tool-executor`;
	const profileId = opts.profileId ?? `${providerId}:tool-profile`;
	const tools =
		opts.tools ??
		([
			{ toolName: "document/read-doc", operation: "read" },
			{ toolName: "file.read", operation: "read" },
			{ toolName: "file.edit/apply-patch", operation: "edit" },
			{ toolName: "bash.run", operation: "run" },
			{ toolName: "url.fetch", operation: "fetch" },
			{ toolName: "date.now", operation: "read" },
			{ toolName: "weather.fetch", operation: "fetch" },
			{ toolName: "calculator/eval", operation: "eval" },
		] satisfies readonly Omit<
			ToolProviderCatalogEntry,
			"kind" | "providerId" | "inputKind" | "profileId" | "executorId"
		>[]);
	const candidatePolicies: readonly unknown[] = opts.policies?.map((policy) =>
		Object.freeze(policy),
	) ?? [
		defaultLocalBuiltinToolProviderExecutionPolicy({
			providerId,
			profileId,
			tools,
			overrides: opts.policyOverrides,
		}),
	];
	const policyIssues = Object.freeze(
		candidatePolicies.flatMap((policy) => [
			...validateToolProviderExecutionPolicy(policy),
			...validateToolProviderPolicyProviderScope(policy, providerId),
		]),
	);
	const policies = Object.freeze(
		candidatePolicies
			.filter((policy) => isPublishableToolProviderExecutionPolicy(policy, providerId))
			.map((policy) => Object.freeze(policy)),
	);
	const policyRefs = Object.freeze(
		policies.map((policy) => ref("tool-provider-execution-policy", policy.policyId)),
	);
	const catalogInputIssues = Object.freeze([
		...forbiddenGraphVisibleMaterialIssues(
			opts.metadata,
			ref("tool-provider-catalog", providerId),
			"catalog-metadata",
		),
		...forbiddenGraphVisibleMaterialIssues(
			opts.capabilities,
			ref("executor-profile", profileId),
			"profile-capabilities",
		),
		...forbiddenGraphVisibleMaterialIssues(
			opts.limits,
			ref("executor-profile", profileId),
			"profile-limits",
		),
		...tools.flatMap((tool) => [
			...forbiddenGraphVisibleMaterialIssues(
				tool.metadata,
				ref("tool", tool.toolName),
				"tool-metadata",
			),
			...forbiddenGraphVisibleMaterialIssues(
				tool.capabilities,
				ref("tool", tool.toolName),
				"tool-capabilities",
			),
			...forbiddenGraphVisibleMaterialIssues(
				tool.limits,
				ref("tool", tool.toolName),
				"tool-limits",
			),
		]),
	]);
	const toolEntries = tools.map((tool) => {
		const toolPolicyRefs = policyRefsForTool(policies, profileId, tool);
		return Object.freeze({
			...tool,
			kind: "tool-catalog-entry",
			providerId,
			inputKind: "tool-call",
			profileId,
			executorId,
			capabilities: sanitizeGraphVisibleRecord(tool.capabilities),
			limits: sanitizeGraphVisibleRecord(tool.limits),
			policyRefs: toolPolicyRefs,
			metadata: sanitizeGraphVisibleRecord(tool.metadata),
		} satisfies ToolProviderCatalogEntry);
	});
	const profilePolicyRefs = policyRefsForProfile(policies, profileId);
	const issues = Object.freeze([...policyIssues, ...catalogInputIssues]);
	return Object.freeze({
		kind: "tool-provider-catalog",
		providerId,
		providerKind: "local-builtin",
		status: issues.length === 0 ? "ready" : "misconfigured",
		profiles: Object.freeze([
			Object.freeze({
				profileId,
				executorId,
				kind: "tool",
				acceptedInputKinds: Object.freeze(["tool-call"]),
				acceptedResultKinds: Object.freeze(
					Array.from(new Set(toolEntries.flatMap((tool) => tool.resultKinds ?? []))),
				),
				capabilities: Object.freeze({
					toolNames: Object.freeze(toolEntries.map((tool) => tool.toolName)),
					...(sanitizeGraphVisibleRecord(opts.capabilities) ?? {}),
				}),
				limits: sanitizeGraphVisibleRecord(opts.limits),
				policyRefs: profilePolicyRefs,
				metadata: sanitizeGraphVisibleRecord(opts.metadata),
			} satisfies ExecutorProfile),
		]),
		tools: Object.freeze(toolEntries),
		policies,
		policyRefs,
		issues: issues.length === 0 ? undefined : issues,
		metadata: sanitizeGraphVisibleRecord(opts.metadata),
	});
}

export function validateToolProviderExecutionPolicy(policy: unknown): readonly DataIssue[] {
	const issues: DataIssue[] = [];
	if (!isRecord(policy)) {
		return Object.freeze([
			dataIssue(
				"tool-provider-policy-invalid-shape",
				"Tool provider policy must be a data object.",
				{ refs: [ref("tool-provider-execution-policy", "<invalid>")] },
			),
		]);
	}
	const policyId = typeof policy.policyId === "string" ? policy.policyId : "";
	const providerId = typeof policy.providerId === "string" ? policy.providerId : "";
	const policyRef = ref("tool-provider-execution-policy", policyId || "<missing>");
	if (policy.kind !== "tool-provider-execution-policy") {
		issues.push(
			dataIssue(
				"tool-provider-policy-invalid-kind",
				"ToolProviderExecutionPolicy.kind must be tool-provider-execution-policy.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	if (!policyId) {
		issues.push(
			dataIssue(
				"tool-provider-policy-missing-policy-id",
				"Tool provider policy is missing policyId.",
				{
					refs: [policyRef],
				},
			),
		);
	}
	if (!providerId) {
		issues.push(
			dataIssue(
				"tool-provider-policy-missing-provider-id",
				"Tool provider policy is missing providerId.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	if (
		policy.sizeCapacity === undefined &&
		policy.timeout === undefined &&
		policy.redaction === undefined &&
		policy.filesystem === undefined &&
		policy.approval === undefined &&
		policy.artifacts === undefined &&
		policy.network === undefined
	) {
		issues.push(
			dataIssue(
				"tool-provider-policy-missing-material",
				"Tool provider policy has no D360 policy material sections.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	if (policy.sizeCapacity !== undefined && !isRecord(policy.sizeCapacity)) {
		issues.push(
			dataIssue(
				"tool-provider-policy-invalid-size-capacity",
				"Tool provider size-capacity policy must be a data object.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	const limits = isRecord(policy.sizeCapacity) ? policy.sizeCapacity.limits : undefined;
	if (isRecord(policy.sizeCapacity) && !Array.isArray(limits)) {
		issues.push(
			dataIssue(
				"tool-provider-policy-invalid-size-capacity",
				"Tool provider size-capacity limits must be an array.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	for (const [index, rawLimit] of (Array.isArray(limits) ? limits : []).entries()) {
		if (!isRecord(rawLimit)) {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-size-limit",
					"Tool provider size-capacity limit must be a data object.",
					{ subjectId: policyId, refs: [policyRef], details: { index } },
				),
			);
			continue;
		}
		const limit = rawLimit as Partial<ToolProviderSizeLimit>;
		if (typeof limit.unit !== "string" || limit.unit.length === 0) {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-size-limit",
					"Tool provider size-capacity limit unit must be a non-empty string.",
					{ subjectId: policyId, refs: [policyRef], details: { index } },
				),
			);
		}
		if (
			limit.softLimit !== undefined &&
			(typeof limit.softLimit !== "number" ||
				!Number.isFinite(limit.softLimit) ||
				limit.softLimit < 0)
		) {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-size-limit",
					"Tool provider size-capacity softLimit must be a finite non-negative number.",
					{ subjectId: policyId, refs: [policyRef], details: { index, unit: limit.unit } },
				),
			);
		}
		if (
			limit.hardLimit !== undefined &&
			(typeof limit.hardLimit !== "number" ||
				!Number.isFinite(limit.hardLimit) ||
				limit.hardLimit < 0)
		) {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-size-limit",
					"Tool provider size-capacity hardLimit must be a finite non-negative number.",
					{ subjectId: policyId, refs: [policyRef], details: { index, unit: limit.unit } },
				),
			);
		}
		if (
			typeof limit.softLimit === "number" &&
			Number.isFinite(limit.softLimit) &&
			typeof limit.hardLimit === "number" &&
			Number.isFinite(limit.hardLimit) &&
			limit.softLimit > limit.hardLimit
		) {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-size-limit",
					"Tool provider size-capacity softLimit must not exceed hardLimit.",
					{ subjectId: policyId, refs: [policyRef], details: { index, unit: limit.unit } },
				),
			);
		}
	}
	if (policy.timeout !== undefined && !isRecord(policy.timeout)) {
		issues.push(
			dataIssue(
				"tool-provider-policy-invalid-timeout",
				"Tool provider timeout policy must be a data object.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	for (const [field, value] of Object.entries(isRecord(policy.timeout) ? policy.timeout : {})) {
		if (field.endsWith("TimeoutMs") || field === "timeoutMs") {
			if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
				issues.push(
					dataIssue(
						"tool-provider-policy-invalid-timeout",
						"Tool provider timeout values must be finite non-negative numbers.",
						{ subjectId: policyId, refs: [policyRef], details: { field } },
					),
				);
			}
		}
	}
	for (const forbidden of forbiddenDataKeys(policy)) {
		issues.push(
			dataIssue(
				"tool-provider-policy-forbidden-runtime-material",
				"Tool provider policy must not contain runtime-private adapter material.",
				{ subjectId: policyId, refs: [policyRef], details: { reason: forbidden.reason } },
			),
		);
	}
	return Object.freeze(issues);
}

export function resolveToolProviderExecutionPolicies(opts: {
	readonly request: AgentRequestIssued;
	readonly routes?: readonly ExecutorRoute[];
	readonly catalogs?: readonly ToolProviderCatalog[];
}): readonly ToolProviderPolicyResolution[] {
	const request = opts.request;
	const toolCall = toolCallFromRequest(request);
	const baseSourceRefs = Object.freeze([ref("agent-request", request.requestId)]);
	if (toolCall === undefined) {
		return Object.freeze([
			Object.freeze({
				kind: "tool-provider-policy-resolution",
				resolutionId: `${request.requestId}:${request.operationId}:tool-policy:missing-tool-call`,
				status: "missing-tool-call",
				requestId: request.requestId,
				operationId: request.operationId,
				issues: Object.freeze([
					dataIssue(
						"tool-provider-policy-missing-tool-call",
						"Tool provider policy resolution requires AgentRequest input.value to be a ToolCallInput.",
						{ subjectId: request.requestId, refs: baseSourceRefs },
					),
				]),
				sourceRefs: baseSourceRefs,
			} satisfies ToolProviderPolicyResolution),
		]);
	}
	const routes = (opts.routes ?? []).filter(
		(route) => route.requestId === request.requestId && route.operationId === request.operationId,
	);
	if (routes.length === 0) {
		return Object.freeze([
			Object.freeze({
				kind: "tool-provider-policy-resolution",
				resolutionId: `${request.requestId}:${request.operationId}:tool-policy:pending-route`,
				status: "pending-route",
				requestId: request.requestId,
				operationId: request.operationId,
				toolName: toolCall.toolName,
				operation: toolCall.operation,
				sourceRefs: baseSourceRefs,
			} satisfies ToolProviderPolicyResolution),
		]);
	}
	return Object.freeze(
		routes.map((route) =>
			Object.freeze(
				resolveToolProviderPolicyForRoute(request, route, toolCall, opts.catalogs ?? []),
			),
		),
	);
}

export function toolProviderPolicyResolutionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly requestFacts: Node<AgentRequestFact>;
		readonly executorRoutes?: readonly Node<ExecutorRoute>[];
		readonly toolProviderCatalogs?: readonly Node<ToolProviderCatalog>[];
	},
): ToolProviderPolicyResolutionBundle {
	const name = opts.name ?? "toolProviderPolicyResolution";
	const routeDeps = opts.executorRoutes ?? [];
	const catalogDeps = opts.toolProviderCatalogs ?? [];
	const routeStart = 1;
	const catalogStart = routeStart + routeDeps.length;
	const runtime = graph.node<ToolProviderPolicyResolutionFact>(
		[opts.requestFacts, ...routeDeps, ...catalogDeps],
		(ctx) => {
			const state = ctx.state.get<ToolProviderPolicyResolutionState>() ?? {
				requests: new Map<string, AgentRequestIssued>(),
				routes: new Map<string, ExecutorRoute>(),
				catalogs: new Map<string, ToolProviderCatalog>(),
				emittedKeys: new Set<string>(),
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "issued" && fact.input?.inputKind === "tool-call") {
					state.requests.set(fact.requestId, fact);
				}
			}
			forEachDepBatch(ctx, routeStart, routeDeps.length, (raw) => {
				const route = raw as ExecutorRoute;
				state.routes.set(route.routeId, route);
			});
			forEachDepBatch(ctx, catalogStart, catalogDeps.length, (raw) => {
				const catalog = raw as ToolProviderCatalog;
				state.catalogs.set(catalog.providerId, catalog);
			});
			for (const request of state.requests.values()) {
				const resolutions = resolveToolProviderExecutionPolicies({
					request,
					routes: Array.from(state.routes.values()),
					catalogs: Array.from(state.catalogs.values()),
				});
				for (const resolution of resolutions) {
					const key = stableToolProviderPolicyResolutionKey(resolution);
					if (state.emittedKeys.has(key)) continue;
					state.emittedKeys.add(key);
					ctx.down([
						["DATA", { kind: "resolution", resolution } satisfies ToolProviderPolicyResolutionFact],
					]);
					for (const issue of resolution.issues ?? []) {
						ctx.down([
							["DATA", { kind: "issue", issue } satisfies ToolProviderPolicyResolutionFact],
						]);
					}
					state.auditSeq += 1;
					ctx.down([
						[
							"DATA",
							{
								kind: "audit",
								audit: {
									id: `${name}:audit:${state.auditSeq}`,
									kind: "tool-provider-policy-resolution",
									subjectId: request.requestId,
									sourceRefs: resolution.sourceRefs,
									metadata: {
										status: resolution.status,
										routeId: resolution.routeId,
										providerId: resolution.providerId,
										profileId: resolution.profileId,
										toolName: resolution.toolName,
									},
								},
							} satisfies ToolProviderPolicyResolutionFact,
						],
					]);
				}
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "toolProviderPolicyResolutionProjector", partial: true },
	);
	const resolutions = projectRuntimeFact(
		graph,
		runtime,
		`${name}/resolutions`,
		"toolProviderPolicyResolutions",
		(fact) => (fact.kind === "resolution" ? fact.resolution : undefined),
	);
	const issues = projectRuntimeFact(
		graph,
		runtime,
		`${name}/issues`,
		"toolProviderPolicyResolutionIssues",
		(fact) => (fact.kind === "issue" ? fact.issue : undefined),
	);
	const audit = projectRuntimeFact(
		graph,
		runtime,
		`${name}/audit`,
		"toolProviderPolicyResolutionAudit",
		(fact) => (fact.kind === "audit" ? fact.audit : undefined),
	);
	return { resolutions, issues, audit };
}

export function buildToolProviderAdapterInputs(opts: {
	readonly requests: readonly AgentRequestIssued[];
	readonly routes?: readonly ExecutorRoute[];
	readonly catalogs?: readonly ToolProviderCatalog[];
	readonly resolutions: readonly ToolProviderPolicyResolution[];
}): readonly ToolProviderAdapterInput[] {
	const requestsById = new Map(opts.requests.map((request) => [request.requestId, request]));
	const routesById = new Map((opts.routes ?? []).map((route) => [route.routeId, route]));
	const catalogsById = new Map(
		(opts.catalogs ?? []).map((catalog) => [catalog.providerId, catalog]),
	);
	return Object.freeze(
		opts.resolutions.map((resolution) =>
			buildToolProviderAdapterInput({
				resolution,
				request: requestsById.get(resolution.requestId),
				route: resolution.routeId === undefined ? undefined : routesById.get(resolution.routeId),
				catalog:
					resolution.providerId === undefined ? undefined : catalogsById.get(resolution.providerId),
			}),
		),
	);
}

export function toolProviderAdapterInputProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly requestFacts: Node<AgentRequestFact>;
		readonly executorRoutes?: readonly Node<ExecutorRoute>[];
		readonly toolProviderCatalogs?: readonly Node<ToolProviderCatalog>[];
		readonly policyResolutions: readonly Node<ToolProviderPolicyResolution>[];
	},
): ToolProviderAdapterInputBundle {
	const name = opts.name ?? "toolProviderAdapterInput";
	const routeDeps = opts.executorRoutes ?? [];
	const catalogDeps = opts.toolProviderCatalogs ?? [];
	const routeStart = 1;
	const catalogStart = routeStart + routeDeps.length;
	const resolutionStart = catalogStart + catalogDeps.length;
	const runtime = graph.node<ToolProviderAdapterInputFact>(
		[opts.requestFacts, ...routeDeps, ...catalogDeps, ...opts.policyResolutions],
		(ctx) => {
			const state = ctx.state.get<ToolProviderAdapterInputState>() ?? {
				requests: new Map<string, AgentRequestIssued>(),
				routes: new Map<string, ExecutorRoute>(),
				catalogs: new Map<string, ToolProviderCatalog>(),
				resolutions: new Map<string, ToolProviderPolicyResolution>(),
				emittedKeys: new Set<string>(),
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "issued" && fact.input?.inputKind === "tool-call") {
					state.requests.set(fact.requestId, fact);
				}
			}
			forEachDepBatch(ctx, routeStart, routeDeps.length, (raw) => {
				const route = raw as ExecutorRoute;
				state.routes.set(route.routeId, route);
			});
			forEachDepBatch(ctx, catalogStart, catalogDeps.length, (raw) => {
				const catalog = raw as ToolProviderCatalog;
				state.catalogs.set(catalog.providerId, catalog);
			});
			forEachDepBatch(ctx, resolutionStart, opts.policyResolutions.length, (raw) => {
				const resolution = raw as ToolProviderPolicyResolution;
				state.resolutions.set(resolution.resolutionId, resolution);
			});
			const inputs = buildToolProviderAdapterInputs({
				requests: Array.from(state.requests.values()),
				routes: Array.from(state.routes.values()),
				catalogs: Array.from(state.catalogs.values()),
				resolutions: Array.from(state.resolutions.values()),
			});
			for (const input of inputs) {
				const key = stableToolProviderAdapterInputKey(input);
				if (state.emittedKeys.has(key)) continue;
				state.emittedKeys.add(key);
				ctx.down([["DATA", { kind: "input", input } satisfies ToolProviderAdapterInputFact]]);
				for (const issue of input.issues ?? []) {
					ctx.down([["DATA", { kind: "issue", issue } satisfies ToolProviderAdapterInputFact]]);
				}
				state.auditSeq += 1;
				ctx.down([
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: `${name}:audit:${state.auditSeq}`,
								kind: "tool-provider-adapter-input",
								subjectId: input.requestId,
								sourceRefs: input.sourceRefs,
								metadata: {
									status: input.status,
									routeId: input.routeId,
									providerId: input.providerId,
									profileId: input.profileId,
									toolName: input.toolName,
								},
							},
						} satisfies ToolProviderAdapterInputFact,
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "toolProviderAdapterInputProjector", partial: true },
	);
	const inputs = projectRuntimeFact(
		graph,
		runtime,
		`${name}/inputs`,
		"toolProviderAdapterInputs",
		(fact) => (fact.kind === "input" ? fact.input : undefined),
	);
	const issues = projectRuntimeFact(
		graph,
		runtime,
		`${name}/issues`,
		"toolProviderAdapterInputIssues",
		(fact) => (fact.kind === "issue" ? fact.issue : undefined),
	);
	const audit = projectRuntimeFact(
		graph,
		runtime,
		`${name}/audit`,
		"toolProviderAdapterInputAudit",
		(fact) => (fact.kind === "audit" ? fact.audit : undefined),
	);
	return { inputs, issues, audit };
}

function normalizeToolProviderAdapterBindings<TArguments, TResult>(
	bindings:
		| readonly ToolProviderAdapterBinding<TArguments, TResult>[]
		| ReadonlyMap<string, ToolProviderAdapterBinding<TArguments, TResult>>,
): ReadonlyMap<string, ToolProviderAdapterBinding<TArguments, TResult>> {
	const result = new Map<string, ToolProviderAdapterBinding<TArguments, TResult>>();
	const bindingList = Array.isArray(bindings)
		? (bindings as readonly ToolProviderAdapterBinding<TArguments, TResult>[])
		: undefined;
	if (bindingList === undefined) {
		const bindingMap = bindings as ReadonlyMap<
			string,
			ToolProviderAdapterBinding<TArguments, TResult>
		>;
		for (const [providerId, binding] of bindingMap.entries()) {
			if (providerId !== binding.providerId) {
				throw new RangeError(
					`attachToolProviderAdapterRuntime: binding key '${providerId}' must match provider '${binding.providerId}'`,
				);
			}
			result.set(providerId, binding);
		}
		return result;
	}
	for (const binding of bindingList) {
		if (result.has(binding.providerId)) {
			throw new RangeError(
				`attachToolProviderAdapterRuntime: duplicate binding for provider '${binding.providerId}'`,
			);
		}
		result.set(binding.providerId, binding);
	}
	return result;
}

function adapterRuntimeIdentity(input: ToolProviderAdapterInput): {
	readonly routeId: string;
	readonly executorId: string;
	readonly profileId: string;
} {
	if (input.status !== "ready") {
		throw new RangeError("buildToolProviderExecutorOutcome: adapter input must be ready");
	}
	if (
		input.routeId === undefined ||
		input.executorId === undefined ||
		input.profileId === undefined
	) {
		throw new RangeError(
			"buildToolProviderExecutorOutcome: ready adapter input is missing route/executor/profile identity",
		);
	}
	return {
		routeId: input.routeId,
		executorId: input.executorId,
		profileId: input.profileId,
	};
}

function defaultToolProviderAdapterEvidenceRefs(
	input: ToolProviderAdapterInput,
): readonly SourceRef[] {
	return sanitizeAdapterInputSourceRefs([
		ref("tool-provider-adapter-input", input.adapterInputId),
		...(input.sourceRefs ?? []),
	]);
}

function defaultToolProviderAdapterRuntimeDedupeKey(input: ToolProviderAdapterInput): string {
	return `${input.adapterInputId}:${stableJsonStringify(input)}`;
}

export function buildToolProviderExecutorOutcome<T = unknown>(
	input: ToolProviderAdapterInput,
	result: ToolProviderAdapterRunResult<T>,
	opts: {
		readonly attempt?: number;
		readonly outcomeId?: string;
		readonly occurredAtMs?: number;
	} = {},
): ExecutorOutcome<T> {
	const ids = adapterRuntimeIdentity(input);
	const attempt = opts.attempt ?? 1;
	const occurredAtMs = result.occurredAtMs ?? opts.occurredAtMs;
	const evidenceRefs =
		result.evidenceRefs === undefined
			? defaultToolProviderAdapterEvidenceRefs(input)
			: sanitizeAdapterInputSourceRefs(result.evidenceRefs);
	const issues =
		result.issues === undefined
			? undefined
			: Object.freeze(result.issues.map(sanitizeAdapterInputIssue));
	const metadata = sanitizeGraphVisibleRecord({
		...(result.metadata ?? {}),
		adapterInputId: input.adapterInputId,
		providerId: input.providerId,
		toolName: input.toolName,
		operation: input.operation,
	});
	const base = {
		outcomeId: opts.outcomeId ?? `${input.adapterInputId}:attempt-${attempt}:${result.kind}`,
		requestId: input.requestId,
		operationId: input.operationId,
		routeId: ids.routeId,
		executorId: ids.executorId,
		profileId: ids.profileId,
		attempt,
		evidenceRefs,
		...(input.input?.inputId === undefined ? {} : { inputId: input.input.inputId }),
		...(input.input?.inputKind === undefined ? {} : { inputKind: input.input.inputKind }),
		...(occurredAtMs === undefined ? {} : { occurredAtMs }),
		...(issues === undefined ? {} : { issues }),
		...(result.usage === undefined ? {} : { usage: result.usage }),
		...(metadata === undefined ? {} : { metadata }),
	};
	const candidate = (() => {
		switch (result.kind) {
			case "result":
				return {
					...base,
					kind: "result",
					result: result.result,
				} satisfies ExecutorOutcome<T>;
			case "failure":
				return {
					...base,
					kind: "failure",
					error: sanitizeAdapterInputIssue(result.error),
					...(result.retryable === undefined ? {} : { retryable: result.retryable }),
				} satisfies ExecutorOutcome<T>;
			case "canceled":
				return {
					...base,
					kind: "canceled",
					...(result.reason === undefined ? {} : { reason: result.reason }),
				} satisfies ExecutorOutcome<T>;
			case "timeout":
				return {
					...base,
					kind: "timeout",
					...(result.timeoutMs === undefined ? {} : { timeoutMs: result.timeoutMs }),
					...(result.retryable === undefined ? {} : { retryable: result.retryable }),
				} satisfies ExecutorOutcome<T>;
			case "blocked":
				return {
					...base,
					kind: "blocked",
					needs: result.needs,
				} satisfies ExecutorOutcome<T>;
		}
	})();
	const leakIssues = forbiddenAdapterRuntimeMaterialIssues(
		candidate,
		ref("executor-outcome", candidate.outcomeId),
		"executor-outcome",
	);
	if (leakIssues.length === 0) return Object.freeze(candidate);
	const issue = leakIssues[0] ?? dataIssue("tool-provider-adapter-runtime-invalid", "invalid");
	return Object.freeze({
		...base,
		kind: "failure",
		outcomeId: `${input.adapterInputId}:attempt-${attempt}:failure`,
		error: issue,
		retryable: false,
		issues: Object.freeze(leakIssues),
	} as ExecutorOutcome<T>);
}

export function attachToolProviderAdapterRuntime<TArguments = unknown, TResult = unknown>(
	graph: Graph,
	opts: ToolProviderAdapterRuntimeOptions<TArguments, TResult>,
): ToolProviderAdapterRuntimeHandle {
	const name = opts.name ?? "toolProviderAdapterRuntime";
	const bindings = normalizeToolProviderAdapterBindings(opts.bindings);
	const outcomes = graph.node<ExecutorOutcome>([], null, {
		name: `${name}/outcomes`,
		factory: "toolProviderAdapterRuntimeOutcomes",
	});
	const status = graph.node<AgentRequestStatusChanged>([], null, {
		name: `${name}/status`,
		factory: "toolProviderAdapterRuntimeStatus",
	});
	const issues = graph.node<DataIssue>([], null, {
		name: `${name}/issues`,
		factory: "toolProviderAdapterRuntimeIssues",
	});
	const audit = graph.node<AgentRuntimeAuditRecord>([], null, {
		name: `${name}/audit`,
		factory: "toolProviderAdapterRuntimeAudit",
	});
	const seen = new Set<string>();
	let disposed = false;
	let auditSeq = 0;
	const attempt = opts.attempt ?? 1;

	function publishIssue(issue: DataIssue): void {
		issues.down([["DATA", sanitizeAdapterInputIssue(issue)]]);
	}

	function publishStatus(
		input: ToolProviderAdapterInput<TArguments>,
		nextStatus: AgentRequestStatus,
		statusIssues?: readonly DataIssue[],
	): void {
		if (input.effectRunId === undefined) return;
		const metadata = sanitizeGraphVisibleRecord({
			adapterInputId: input.adapterInputId,
			providerId: input.providerId,
			toolName: input.toolName,
		});
		status.down([
			[
				"DATA",
				{
					kind: "status",
					requestId: input.requestId,
					operationId: input.operationId,
					effectRunId: input.effectRunId,
					status: nextStatus,
					sourceRefs: defaultToolProviderAdapterEvidenceRefs(input),
					...(statusIssues === undefined ? {} : { issues: statusIssues }),
					...(metadata === undefined ? {} : { metadata }),
				} satisfies AgentRequestStatusChanged,
			],
		]);
	}

	function publishAudit(
		input: ToolProviderAdapterInput<TArguments>,
		kind: string,
		metadata?: Record<string, unknown>,
		issueCode?: string,
	): void {
		auditSeq += 1;
		const cleanMetadata = sanitizeGraphVisibleRecord({
			adapterInputId: input.adapterInputId,
			providerId: input.providerId,
			toolName: input.toolName,
			...metadata,
		});
		audit.down([
			[
				"DATA",
				{
					id: `${name}:audit:${auditSeq}`,
					kind,
					subjectId: input.requestId,
					sourceRefs: defaultToolProviderAdapterEvidenceRefs(input),
					...(issueCode === undefined ? {} : { issueCode }),
					...(cleanMetadata === undefined ? {} : { metadata: cleanMetadata }),
				} satisfies AgentRuntimeAuditRecord,
			],
		]);
	}

	function publishOutcome(
		input: ToolProviderAdapterInput<TArguments>,
		result: ToolProviderAdapterRunResult<TResult>,
	): void {
		if (disposed) return;
		let outcome: ExecutorOutcome<TResult>;
		try {
			outcome = buildToolProviderExecutorOutcome(input, result, {
				attempt,
				occurredAtMs: opts.now?.(),
			});
		} catch (error) {
			const issue = adapterRuntimeIssue(
				input,
				"tool-provider-adapter-runtime-invalid-input",
				error,
			);
			publishIssue(issue);
			publishStatus(input, "failed", [issue]);
			publishAudit(input, "tool-provider-adapter-runtime-invalid-input", undefined, issue.code);
			return;
		}
		outcomes.down([["DATA", outcome]]);
		const publishedIssueKeys = new Set<string>();
		for (const issue of outcome.issues ?? []) {
			publishedIssueKeys.add(`${issue.code}:${issue.message}`);
			publishIssue(issue);
		}
		if (
			outcome.kind === "failure" &&
			!publishedIssueKeys.has(`${outcome.error.code}:${outcome.error.message}`)
		) {
			publishIssue(outcome.error);
		}
		const statusIssues = outcomeIssues(outcome);
		publishStatus(
			input,
			agentRequestStatusForExecutorOutcome(outcome),
			statusIssues.length === 0 ? undefined : statusIssues,
		);
		publishAudit(input, "tool-provider-adapter-runtime-finished", {
			status: outcome.kind,
			outcomeId: outcome.outcomeId,
		});
	}

	function publishRuntimeFailure(
		input: ToolProviderAdapterInput<TArguments>,
		code: string,
		error: unknown,
	): void {
		const issue = adapterRuntimeIssue(input, code, error);
		publishOutcome(input, {
			kind: "failure",
			error: issue,
			retryable: false,
			issues: [issue],
		});
	}

	function runInput(input: ToolProviderAdapterInput<TArguments>): void {
		if (disposed || input.status !== "ready") return;
		let key: string;
		try {
			key = opts.dedupeKey?.(input) ?? defaultToolProviderAdapterRuntimeDedupeKey(input);
		} catch (error) {
			publishRuntimeFailure(input, "tool-provider-adapter-runtime-dedupe-key-threw", error);
			return;
		}
		if (seen.has(key)) return;
		seen.add(key);
		const binding = input.providerId === undefined ? undefined : bindings.get(input.providerId);
		if (binding === undefined) {
			const issue = dataIssue(
				"tool-provider-adapter-runtime-missing-binding",
				"Tool provider adapter runtime requires a matching runtime-private binding.",
				{
					subjectId: input.requestId,
					refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
					details: { providerId: input.providerId },
				},
			);
			publishOutcome(input, {
				kind: "blocked",
				needs: [
					{
						kind: "tool-provider-binding",
						message: "Matching runtime-private tool provider binding is unavailable.",
						...(input.providerId === undefined
							? {}
							: { refs: [ref("tool-provider", input.providerId)] }),
					},
				],
				issues: [issue],
			});
			return;
		}
		publishStatus(input, "in-flight");
		publishAudit(input, "tool-provider-adapter-runtime-started", {
			providerId: binding.providerId,
			attempt,
		});
		let result:
			| ToolProviderAdapterRunResult<TResult>
			| PromiseLike<ToolProviderAdapterRunResult<TResult>>;
		try {
			result = binding.run(input, {
				attempt,
				sourceRefs: input.sourceRefs ?? [],
				now: opts.now,
			});
		} catch (error) {
			publishRuntimeFailure(input, "tool-provider-adapter-runtime-threw", error);
			return;
		}
		if (isThenable(result)) {
			let settled = false;
			try {
				result.then(
					(value) => {
						if (settled) return;
						settled = true;
						publishOutcome(input, value);
					},
					(error) => {
						if (settled) return;
						settled = true;
						publishRuntimeFailure(input, "tool-provider-adapter-runtime-rejected", error);
					},
				);
			} catch (error) {
				if (!settled) publishRuntimeFailure(input, "tool-provider-adapter-runtime-rejected", error);
			}
			return;
		}
		publishOutcome(input, result);
	}

	const unsubscribe = opts.inputs.subscribe((msg) => {
		if (msg[0] !== "DATA") return;
		runInput(msg[1] as ToolProviderAdapterInput<TArguments>);
	});

	return {
		outcomes,
		status,
		issues,
		audit,
		dispose() {
			if (disposed) return;
			disposed = true;
			unsubscribe();
		},
	};
}

function agentRequestStatusForExecutorOutcome(outcome: ExecutorOutcome): AgentRequestStatus {
	switch (outcome.kind) {
		case "result":
			return "completed";
		case "failure":
			return "failed";
		case "canceled":
			return "canceled";
		case "timeout":
			return "timeout";
		case "blocked":
			return "blocked";
	}
}

function adapterRuntimeIssue(
	input: ToolProviderAdapterInput,
	code: string,
	error: unknown,
): DataIssue {
	return dataIssue(code, "Tool provider adapter runtime failed.", {
		subjectId: input.requestId,
		refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
		details: { errorType: error instanceof Error ? error.name : typeof error },
	});
}

function forbiddenAdapterRuntimeMaterialIssues(
	value: unknown,
	subjectRef: SourceRef,
	area: string,
): readonly DataIssue[] {
	if (value === undefined) return [];
	const forbidden = forbiddenDataKeys(value);
	if (forbidden.length === 0) return [];
	return Object.freeze(
		forbidden.map((entry) =>
			dataIssue(
				"tool-provider-adapter-runtime-forbidden-runtime-material",
				"Tool provider adapter runtime output must not contain runtime-private adapter material.",
				{ subjectId: subjectRef.id, refs: [subjectRef], details: { area, reason: entry.reason } },
			),
		),
	);
}

function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
	return typeof (value as { then?: unknown }).then === "function";
}

function isPublishableToolProviderExecutionPolicy(
	policy: unknown,
	providerId?: string,
): policy is ToolProviderExecutionPolicy {
	return (
		isRecord(policy) &&
		policy.kind === "tool-provider-execution-policy" &&
		typeof policy.policyId === "string" &&
		policy.policyId.length > 0 &&
		typeof policy.providerId === "string" &&
		policy.providerId.length > 0 &&
		(providerId === undefined || policy.providerId === providerId) &&
		validateToolProviderExecutionPolicy(policy).length === 0
	);
}

function validateToolProviderPolicyProviderScope(
	policy: unknown,
	providerId: string,
): readonly DataIssue[] {
	if (!isRecord(policy)) return [];
	if (policy.providerId === undefined || policy.providerId === providerId) return [];
	return Object.freeze([
		dataIssue(
			"tool-provider-policy-provider-mismatch",
			"Tool provider policy providerId must match the catalog providerId.",
			{
				subjectId: typeof policy.policyId === "string" ? policy.policyId : undefined,
				refs: [
					ref(
						"tool-provider-execution-policy",
						typeof policy.policyId === "string" && policy.policyId.length > 0
							? policy.policyId
							: "<missing>",
					),
					ref("tool-provider-catalog", providerId),
				],
			},
		),
	]);
}

function policyRefsForProfile(
	policies: readonly ToolProviderExecutionPolicy[],
	profileId: string,
): readonly SourceRef[] {
	return Object.freeze(
		policies
			.filter((policy) => policyAppliesToProfile(policy, profileId))
			.map((policy) => ref("tool-provider-execution-policy", policy.policyId)),
	);
}

function policyRefsForTool(
	policies: readonly ToolProviderExecutionPolicy[],
	profileId: string,
	tool: Omit<
		ToolProviderCatalogEntry,
		"kind" | "providerId" | "inputKind" | "profileId" | "executorId"
	>,
): readonly SourceRef[] {
	return Object.freeze(
		policies
			.filter((policy) => policyAppliesToProfile(policy, profileId))
			.filter((policy) => policyAppliesToOptionalScope(policy.toolNames, tool.toolName))
			.filter((policy) => policyAppliesToOptionalScope(policy.operations, tool.operation))
			.map((policy) => ref("tool-provider-execution-policy", policy.policyId)),
	);
}

function policyAppliesToProfile(policy: ToolProviderExecutionPolicy, profileId: string): boolean {
	return policyAppliesToOptionalScope(policy.profileIds, profileId);
}

function policyAppliesToOptionalScope(
	scope: readonly string[] | undefined,
	value: string | undefined,
): boolean {
	return (
		scope === undefined || scope.length === 0 || (value !== undefined && scope.includes(value))
	);
}

function toolCallFromRequest(request: AgentRequestIssued): ToolCallInput | undefined {
	const value = request.input?.value;
	if (request.input?.inputKind !== "tool-call" || !isRecord(value)) return undefined;
	if (
		value.kind !== "tool-call" ||
		typeof value.toolName !== "string" ||
		value.toolName.length === 0
	) {
		return undefined;
	}
	return value as unknown as ToolCallInput;
}

function resolveToolProviderPolicyForRoute(
	request: AgentRequestIssued,
	route: ExecutorRoute,
	toolCall: ToolCallInput,
	catalogs: readonly ToolProviderCatalog[],
): ToolProviderPolicyResolution {
	const sourceRefs = Object.freeze([
		ref("agent-request", request.requestId),
		ref("executor-route", route.routeId),
	]);
	const matchingCatalogs = catalogs.filter((catalog) => catalogHasRouteProfile(catalog, route));
	if (matchingCatalogs.length === 0) {
		return policyResolutionWithIssue({
			request,
			route,
			toolCall,
			status: "missing-catalog",
			sourceRefs,
			issue: dataIssue(
				"tool-provider-policy-missing-catalog",
				`No tool provider catalog exposes route profile '${route.profileId}'.`,
				{ subjectId: request.requestId, refs: sourceRefs },
			),
		});
	}
	if (matchingCatalogs.length > 1) {
		return policyResolutionWithIssue({
			request,
			route,
			toolCall,
			status: "ambiguous-catalog",
			sourceRefs,
			issue: dataIssue(
				"tool-provider-policy-ambiguous-catalog",
				`Multiple tool provider catalogs expose route profile '${route.profileId}'.`,
				{
					subjectId: request.requestId,
					refs: [
						...sourceRefs,
						...matchingCatalogs.map((catalog) => ref("tool-provider-catalog", catalog.providerId)),
					],
				},
			),
		});
	}
	const catalog = matchingCatalogs[0];
	if (catalog === undefined) throw new Error("unreachable catalog match");
	const tool = catalog.tools.find(
		(entry) =>
			entry.profileId === route.profileId &&
			entry.executorId === route.executorId &&
			entry.toolName === toolCall.toolName &&
			(entry.operation === undefined ||
				toolCall.operation === undefined ||
				entry.operation === toolCall.operation),
	);
	if (tool === undefined) {
		return policyResolutionWithIssue({
			request,
			route,
			toolCall,
			status: "missing-tool",
			sourceRefs,
			providerId: catalog.providerId,
			issue: dataIssue(
				"tool-provider-policy-missing-tool",
				`Tool provider catalog '${catalog.providerId}' does not expose requested tool '${toolCall.toolName}'.`,
				{
					subjectId: request.requestId,
					refs: [...sourceRefs, ref("tool-provider-catalog", catalog.providerId)],
				},
			),
		});
	}
	const policyRefs = policyRefsForResolution(catalog, route, tool);
	if (policyRefs.length === 0) {
		return policyResolutionWithIssue({
			request,
			route,
			toolCall,
			status: "missing-policy",
			sourceRefs,
			providerId: catalog.providerId,
			issue: dataIssue(
				"tool-provider-policy-missing-policy-ref",
				`Tool '${tool.toolName}' has no D360 policy refs on its entry, profile, or catalog.`,
				{
					subjectId: request.requestId,
					refs: [...sourceRefs, ref("tool-provider-catalog", catalog.providerId)],
				},
			),
		});
	}
	const issues = policyIssuesForRefs(catalog, policyRefs, request, sourceRefs);
	const status = issues.length === 0 ? "resolved" : "invalid-policy";
	return Object.freeze({
		kind: "tool-provider-policy-resolution",
		resolutionId: `${request.requestId}:${request.operationId}:${route.routeId}:tool-policy`,
		status,
		requestId: request.requestId,
		operationId: request.operationId,
		routeId: route.routeId,
		providerId: catalog.providerId,
		executorId: route.executorId,
		profileId: route.profileId,
		toolName: toolCall.toolName,
		operation: toolCall.operation,
		policyRefs,
		issues: issues.length === 0 ? undefined : Object.freeze(issues),
		sourceRefs: Object.freeze([...sourceRefs, ref("tool-provider-catalog", catalog.providerId)]),
	} satisfies ToolProviderPolicyResolution);
}

function catalogHasRouteProfile(catalog: ToolProviderCatalog, route: ExecutorRoute): boolean {
	return catalog.profiles.some(
		(profile) => profile.profileId === route.profileId && profile.executorId === route.executorId,
	);
}

function policyRefsForResolution(
	catalog: ToolProviderCatalog,
	route: ExecutorRoute,
	tool: ToolProviderCatalogEntry,
): readonly SourceRef[] {
	const profile = catalog.profiles.find(
		(candidate) =>
			candidate.profileId === route.profileId && candidate.executorId === route.executorId,
	);
	return Object.freeze([
		...(tool.policyRefs ?? []),
		...((tool.policyRefs?.length ?? 0) === 0 ? (profile?.policyRefs ?? []) : []),
		...((tool.policyRefs?.length ?? 0) === 0 && (profile?.policyRefs?.length ?? 0) === 0
			? (catalog.policyRefs ?? [])
			: []),
	]);
}

function policyIssuesForRefs(
	catalog: ToolProviderCatalog,
	policyRefs: readonly SourceRef[],
	request: AgentRequestIssued,
	sourceRefs: readonly SourceRef[],
): readonly DataIssue[] {
	const policiesById = new Map((catalog.policies ?? []).map((policy) => [policy.policyId, policy]));
	const issues: DataIssue[] = [];
	for (const policyRef of policyRefs) {
		if (policyRef.kind !== "tool-provider-execution-policy") {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-ref-kind",
					"Tool provider policy refs must point at ToolProviderExecutionPolicy facts.",
					{ subjectId: request.requestId, refs: [...sourceRefs, policyRef] },
				),
			);
			continue;
		}
		const policy = policiesById.get(policyRef.id);
		if (policy === undefined) {
			issues.push(
				dataIssue(
					"tool-provider-policy-ref-missing-material",
					`Tool provider policy ref '${policyRef.id}' has no policy material in catalog '${catalog.providerId}'.`,
					{ subjectId: request.requestId, refs: [...sourceRefs, policyRef] },
				),
			);
			continue;
		}
		issues.push(...validateToolProviderExecutionPolicy(policy));
		issues.push(...validateToolProviderPolicyProviderScope(policy, catalog.providerId));
	}
	return Object.freeze(issues);
}

function policyResolutionWithIssue(opts: {
	readonly request: AgentRequestIssued;
	readonly route: ExecutorRoute;
	readonly toolCall: ToolCallInput;
	readonly status: ToolProviderPolicyResolutionStatus;
	readonly sourceRefs: readonly SourceRef[];
	readonly issue: DataIssue;
	readonly providerId?: string;
}): ToolProviderPolicyResolution {
	return Object.freeze({
		kind: "tool-provider-policy-resolution",
		resolutionId: `${opts.request.requestId}:${opts.request.operationId}:${opts.route.routeId}:tool-policy:${opts.status}`,
		status: opts.status,
		requestId: opts.request.requestId,
		operationId: opts.request.operationId,
		routeId: opts.route.routeId,
		providerId: opts.providerId,
		executorId: opts.route.executorId,
		profileId: opts.route.profileId,
		toolName: opts.toolCall.toolName,
		operation: opts.toolCall.operation,
		issues: Object.freeze([opts.issue]),
		sourceRefs: opts.sourceRefs,
	} satisfies ToolProviderPolicyResolution);
}

function stableToolProviderPolicyResolutionKey(resolution: ToolProviderPolicyResolution): string {
	return JSON.stringify({
		id: resolution.resolutionId,
		status: resolution.status,
		policyRefs:
			resolution.policyRefs?.map((policyRef) => `${policyRef.kind}:${policyRef.id}`) ?? [],
		issues: resolution.issues?.map((issue) => issue.code) ?? [],
	});
}

function buildToolProviderAdapterInput(opts: {
	readonly resolution: ToolProviderPolicyResolution;
	readonly request?: AgentRequestIssued;
	readonly route?: ExecutorRoute;
	readonly catalog?: ToolProviderCatalog;
}): ToolProviderAdapterInput {
	const { resolution, request, route, catalog } = opts;
	const sourceRefs = sanitizeAdapterInputSourceRefs([
		ref("tool-provider-policy-resolution", resolution.resolutionId),
		...(resolution.sourceRefs ?? []),
		...(resolution.routeId === undefined ? [] : [ref("executor-route", resolution.routeId)]),
		...(resolution.providerId === undefined
			? []
			: [ref("tool-provider-catalog", resolution.providerId)]),
		...(resolution.policyRefs ?? []),
	]);
	const issues: DataIssue[] = (resolution.issues ?? []).map(sanitizeAdapterInputIssue);
	let statusOverride: Exclude<ToolProviderAdapterInputStatus, "ready"> | undefined;
	if (request === undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-request",
				"Tool provider adapter input requires the issued AgentRequest fact.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (request !== undefined && request.requestId !== resolution.requestId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-request",
				"Tool provider adapter input request identity does not match its policy resolution.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (request !== undefined && request.operationId !== resolution.operationId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-request-operation",
				"Tool provider adapter input request operationId does not match its policy resolution.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (resolution.routeId !== undefined && route === undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-route",
				"Tool provider adapter input requires the selected ExecutorRoute fact.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (route !== undefined) {
		issues.push(...routeIdentityIssuesForAdapterInput(route, resolution, request, sourceRefs));
	}
	if (resolution.providerId !== undefined && catalog === undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-catalog",
				"Tool provider adapter input requires the selected ToolProviderCatalog fact.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (catalog !== undefined && catalog.status !== undefined && catalog.status !== "ready") {
		statusOverride = "invalid-policy";
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-catalog-unavailable",
				"Tool provider adapter input requires a ready ToolProviderCatalog.",
				{
					subjectId: resolution.requestId,
					refs: [...sourceRefs, ref("tool-provider-catalog", catalog.providerId)],
					details: { status: catalog.status },
				},
			),
		);
		issues.push(...(catalog.issues ?? []).map(sanitizeAdapterInputIssue));
	}
	const toolCall = request === undefined ? undefined : toolCallFromRequest(request);
	if (request !== undefined && toolCall === undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-tool-call",
				"Tool provider adapter input requires AgentRequest input.value to be a ToolCallInput.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	const tool =
		catalog === undefined || route === undefined || toolCall === undefined
			? undefined
			: selectedToolForAdapterInput(catalog, route, toolCall);
	if (resolution.status === "resolved" && tool === undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-tool",
				"Tool provider adapter input requires the selected catalog tool entry.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	const policies =
		catalog === undefined
			? []
			: selectedPoliciesForAdapterInput(catalog, resolution.policyRefs ?? []);
	if (resolution.status === "resolved" && (resolution.policyRefs?.length ?? 0) === 0) {
		statusOverride = "missing-policy";
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-policy-ref",
				"Ready tool provider adapter input requires at least one D360 policy ref.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (catalog !== undefined) {
		for (const issue of policyMaterialIssuesForAdapterInput(catalog, resolution, sourceRefs)) {
			statusOverride ??= "invalid-policy";
			issues.push(issue);
		}
	}
	for (const policy of policies) {
		issues.push(...validateToolProviderExecutionPolicy(policy));
		if (catalog !== undefined)
			issues.push(...validateToolProviderPolicyProviderScope(policy, catalog.providerId));
	}
	if (request?.input !== undefined) {
		issues.push(
			...forbiddenAdapterInputMaterialIssues(
				request.input,
				ref("agent-request", request.requestId),
				"request-input",
			),
		);
	}
	if (route !== undefined) {
		issues.push(
			...forbiddenAdapterInputMaterialIssues(
				route.allowedParams,
				ref("executor-route", route.routeId),
				"route-allowed-params",
			),
			...forbiddenAdapterInputMaterialIssues(
				route.metadata,
				ref("executor-route", route.routeId),
				"route-metadata",
			),
		);
	}
	if (tool !== undefined) {
		const toolRef = ref("tool", tool.toolName);
		issues.push(
			...forbiddenAdapterInputMaterialIssues(tool.capabilities, toolRef, "tool-capabilities"),
			...forbiddenAdapterInputMaterialIssues(tool.limits, toolRef, "tool-limits"),
			...forbiddenAdapterInputMaterialIssues(tool.metadata, toolRef, "tool-metadata"),
		);
	}
	for (const policy of policies) {
		issues.push(
			...forbiddenAdapterInputMaterialIssues(
				policy,
				ref("tool-provider-execution-policy", policy.policyId),
				"policy-material",
			),
		);
	}
	const status =
		resolution.status === "resolved"
			? issues.length === 0
				? "ready"
				: (statusOverride ?? "invalid-policy")
			: resolution.status;
	const ready = status === "ready";
	const candidate = {
		kind: "tool-provider-adapter-input",
		adapterInputId: `${resolution.requestId}:${resolution.operationId}:${resolution.routeId ?? resolution.resolutionId}:adapter-input`,
		status,
		requestId: resolution.requestId,
		operationId: resolution.operationId,
		effectRunId: request?.effectRunId,
		agentRunId: request?.agentRunId,
		routeId: resolution.routeId,
		providerId: resolution.providerId,
		executorId: resolution.executorId,
		profileId: resolution.profileId,
		toolName: resolution.toolName,
		operation: resolution.operation,
		input: ready ? (request?.input as AgentRequestInput<ToolCallInput> | undefined) : undefined,
		toolCall: ready ? toolCall : undefined,
		route: ready ? route : undefined,
		tool: ready ? tool : undefined,
		policies: ready ? Object.freeze(policies) : undefined,
		policyRefs: sanitizeAdapterInputSourceRefs(resolution.policyRefs ?? []),
		sourceRefs,
		issues: issues.length === 0 ? undefined : Object.freeze(issues),
		metadata: { resolutionId: resolution.resolutionId },
	} satisfies ToolProviderAdapterInput;
	if (ready) {
		const candidateIssues = forbiddenAdapterInputMaterialIssues(
			candidate,
			ref("tool-provider-adapter-input", candidate.adapterInputId),
			"adapter-input",
		);
		if (candidateIssues.length > 0) {
			const blockedIssues = Object.freeze([...issues, ...candidateIssues]);
			return Object.freeze({
				...candidate,
				status: "invalid-policy",
				input: undefined,
				toolCall: undefined,
				route: undefined,
				tool: undefined,
				policies: undefined,
				issues: blockedIssues,
			} satisfies ToolProviderAdapterInput);
		}
	}
	return Object.freeze(candidate);
}

function selectedToolForAdapterInput(
	catalog: ToolProviderCatalog,
	route: ExecutorRoute,
	toolCall: ToolCallInput,
): ToolProviderCatalogEntry | undefined {
	return catalog.tools.find(
		(entry) =>
			entry.profileId === route.profileId &&
			entry.executorId === route.executorId &&
			entry.toolName === toolCall.toolName &&
			(entry.operation === undefined ||
				toolCall.operation === undefined ||
				entry.operation === toolCall.operation),
	);
}

function selectedPoliciesForAdapterInput(
	catalog: ToolProviderCatalog,
	policyRefs: readonly SourceRef[],
): ToolProviderExecutionPolicy[] {
	const policiesById = new Map((catalog.policies ?? []).map((policy) => [policy.policyId, policy]));
	const policies: ToolProviderExecutionPolicy[] = [];
	for (const policyRef of policyRefs) {
		if (policyRef.kind !== "tool-provider-execution-policy") continue;
		const policy = policiesById.get(policyRef.id);
		if (policy !== undefined) policies.push(policy);
	}
	return policies;
}

function routeIdentityIssuesForAdapterInput(
	route: ExecutorRoute,
	resolution: ToolProviderPolicyResolution,
	request: AgentRequestIssued | undefined,
	sourceRefs: readonly SourceRef[],
): readonly DataIssue[] {
	const issues: DataIssue[] = [];
	const refs = [...sourceRefs, ref("executor-route", route.routeId)];
	if (route.requestId !== resolution.requestId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-request",
				"ExecutorRoute requestId does not match the tool provider policy resolution.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (route.operationId !== resolution.operationId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-operation",
				"ExecutorRoute operationId does not match the tool provider policy resolution.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (resolution.routeId !== undefined && route.routeId !== resolution.routeId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-id",
				"ExecutorRoute routeId does not match the tool provider policy resolution.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (resolution.executorId !== undefined && route.executorId !== resolution.executorId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-executor",
				"ExecutorRoute executorId does not match the tool provider policy resolution.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (resolution.profileId !== undefined && route.profileId !== resolution.profileId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-profile",
				"ExecutorRoute profileId does not match the tool provider policy resolution.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (
		request !== undefined &&
		route.inputId !== undefined &&
		route.inputId !== request.input?.inputId
	) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-input",
				"ExecutorRoute inputId does not match the issued AgentRequest input.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (route.inputKind !== undefined && route.inputKind !== "tool-call") {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-invalid-route-input-kind",
				"Tool provider adapter input requires ExecutorRoute.inputKind to be tool-call when present.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (
		request !== undefined &&
		route.inputKind !== undefined &&
		request.input?.inputKind !== undefined &&
		route.inputKind !== request.input.inputKind
	) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-input-kind",
				"ExecutorRoute inputKind does not match the issued AgentRequest input.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	return Object.freeze(issues);
}

function policyMaterialIssuesForAdapterInput(
	catalog: ToolProviderCatalog,
	resolution: ToolProviderPolicyResolution,
	sourceRefs: readonly SourceRef[],
): readonly DataIssue[] {
	const policiesById = new Map((catalog.policies ?? []).map((policy) => [policy.policyId, policy]));
	const issues: DataIssue[] = [];
	for (const policyRef of resolution.policyRefs ?? []) {
		if (policyRef.kind !== "tool-provider-execution-policy") {
			issues.push(
				dataIssue(
					"tool-provider-adapter-input-invalid-policy-ref-kind",
					"Tool provider adapter input policy refs must point at ToolProviderExecutionPolicy facts.",
					{ subjectId: resolution.requestId, refs: [...sourceRefs, policyRef] },
				),
			);
			continue;
		}
		if (!policiesById.has(policyRef.id)) {
			issues.push(
				dataIssue(
					"tool-provider-adapter-input-policy-ref-missing-material",
					"Tool provider adapter input policy ref has no selected policy material.",
					{ subjectId: resolution.requestId, refs: [...sourceRefs, policyRef] },
				),
			);
		}
	}
	return Object.freeze(issues);
}

function sanitizeAdapterInputIssue(issue: DataIssue): DataIssue {
	if (forbiddenDataKeys(issue).length === 0) return issue;
	const details =
		issue.details === undefined || forbiddenDataKeys(issue.details).length > 0
			? { redacted: true, reason: "forbidden-runtime-material" }
			: issue.details;
	return Object.freeze({
		kind: issue.kind,
		code: issue.code,
		message: issue.message,
		severity: issue.severity,
		subjectId: issue.subjectId,
		refs: issue.refs,
		details,
	} satisfies DataIssue);
}

function stableToolProviderAdapterInputKey(input: ToolProviderAdapterInput): string {
	return stableJsonStringify({
		id: input.adapterInputId,
		status: input.status,
		policyRefs: input.policyRefs?.map((policyRef) => `${policyRef.kind}:${policyRef.id}`) ?? [],
		issues: input.issues?.map((issue) => issue.code) ?? [],
		input,
	});
}

function defaultLocalBuiltinToolProviderExecutionPolicy(opts: {
	readonly providerId: string;
	readonly profileId: string;
	readonly tools: readonly Omit<
		ToolProviderCatalogEntry,
		"kind" | "providerId" | "inputKind" | "profileId" | "executorId"
	>[];
	readonly overrides?: Partial<
		Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">
	>;
}): ToolProviderExecutionPolicy {
	const toolNames = Object.freeze(Array.from(new Set(opts.tools.map((tool) => tool.toolName))));
	const operations = Object.freeze(
		Array.from(new Set(opts.tools.map((tool) => tool.operation).filter((op) => op !== undefined))),
	);
	const hasUrlFetch = toolNames.includes("url.fetch");
	const filesystemToolNames = toolNames.filter(
		(toolName) =>
			toolName.startsWith("file.") || toolName.startsWith("document/") || toolName === "bash.run",
	);
	const approvalToolNames = toolNames.filter(
		(toolName) => toolName === "file.edit/apply-patch" || toolName === "bash.run",
	);
	const approvalOperations = operations.filter(
		(operation) => operation === "edit" || operation === "run",
	);
	const policy = {
		kind: "tool-provider-execution-policy",
		policyId: `${opts.providerId}:policy:default`,
		providerId: opts.providerId,
		profileIds: Object.freeze([opts.profileId]),
		toolNames,
		operations,
		sizeCapacity: Object.freeze({
			limits: Object.freeze([
				Object.freeze({
					unit: "chars",
					softLimit: 16_384,
					hardLimit: 65_536,
					perRequest: true,
					measurementSource: "adapter-estimated",
				} satisfies ToolProviderSizeLimit),
				Object.freeze({
					unit: "bytes",
					softLimit: 1_048_576,
					hardLimit: 8_388_608,
					perArtifact: true,
					measurementSource: "adapter-measured",
				} satisfies ToolProviderSizeLimit),
				Object.freeze({
					unit: "lines",
					softLimit: 2_000,
					hardLimit: 10_000,
					perStream: true,
					measurementSource: "adapter-measured",
				} satisfies ToolProviderSizeLimit),
			]),
		} satisfies ToolProviderSizeCapacityPolicy),
		timeout: Object.freeze({
			timeoutMs: 30_000,
			idleTimeoutMs: 5_000,
		} satisfies ToolProviderTimeoutPolicy),
		redaction: Object.freeze({
			mode: "summary",
			sensitivity: Object.freeze(["private-material", "auth-material", "personal-data"]),
			summaryMaxChars: 512,
		} satisfies ToolProviderRedactionPolicy),
		...(filesystemToolNames.length > 0
			? {
					filesystem: Object.freeze({
						cwd: ".",
						allowRead: true,
						allowWrite: false,
						followSymlinks: false,
						sourceRefs: Object.freeze(filesystemToolNames.map((toolName) => ref("tool", toolName))),
						pathRules: Object.freeze([
							Object.freeze({
								effect: "allow",
								path: ".",
								operation: "read",
								reason: "Default local builtin catalog is workspace-relative data material.",
							} satisfies ToolProviderPathRule),
							Object.freeze({
								effect: "deny",
								glob: "**/.env*",
								reason: "D360 policies keep private material outside catalog DATA.",
							} satisfies ToolProviderPathRule),
						]),
					} satisfies ToolProviderFilesystemPolicy),
				}
			: {}),
		...(hasUrlFetch
			? {
					network: Object.freeze({
						mode: "custom",
						protocols: Object.freeze(["https:"]),
						allowedHosts: Object.freeze(["*"]),
						sourceRefs: Object.freeze([ref("tool", "url.fetch")]),
					} satisfies ToolProviderNetworkPolicy),
				}
			: {}),
		approval: Object.freeze({
			mode: approvalToolNames.length > 0 ? "require" : "auto",
			...(approvalToolNames.length > 0
				? { requiredForToolNames: Object.freeze(approvalToolNames) }
				: {}),
			...(approvalOperations.length > 0
				? { requiredForOperations: Object.freeze(approvalOperations) }
				: {}),
		} satisfies ToolProviderApprovalPolicy),
		artifacts: Object.freeze({
			defaultDataMode: "summary",
			artifactKinds: Object.freeze([
				"text",
				"markdown",
				"file",
				"stdout",
				"stderr",
				"tool-output",
				"provider-raw",
			]),
			inlineLimits: Object.freeze([
				Object.freeze({
					unit: "chars",
					hardLimit: 4_096,
					perArtifact: true,
					measurementSource: "adapter-estimated",
				} satisfies ToolProviderSizeLimit),
			]),
			requireDigest: false,
		} satisfies ToolProviderArtifactPolicy),
		sourceRefs: Object.freeze([ref("decision", "D360"), ref("tool-provider", opts.providerId)]),
		metadata: Object.freeze({
			description: "Default data-only policy material for local builtin tools.",
		}),
		...unlockedToolProviderPolicyOverrides(opts.overrides),
	} satisfies ToolProviderExecutionPolicy;
	return Object.freeze(policy);
}

export function executorOutcomeViewProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly outcomes: Node<ExecutorOutcome>;
		readonly policy?: ExecutorOutcomeViewPolicy;
	},
): ExecutorOutcomeViewBundle {
	const name = opts.name ?? "executorOutcomeViews";
	const policy = {
		audience: opts.policy?.audience ?? "agent-observation",
		maxSummaryChars: opts.policy?.maxSummaryChars ?? 512,
		includeIssues: opts.policy?.includeIssues ?? true,
		includeUsage: opts.policy?.includeUsage ?? false,
		includeMetadata: opts.policy?.includeMetadata ?? false,
	} satisfies Required<ExecutorOutcomeViewPolicy>;
	const runtime = graph.node<ExecutorOutcomeViewFact>(
		[opts.outcomes],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = raw as ExecutorOutcome;
				const projection = executorOutcomeViewProjectionFromOutcome(outcome, policy);
				ctx.down([
					["DATA", { kind: "view", view: projection.view } satisfies ExecutorOutcomeViewFact],
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: `${outcome.outcomeId}:outcome-view:${policy.audience}`,
								kind: "executor-outcome-view-projected",
								subjectId: outcome.requestId,
								sourceRefs: [ref("executor-outcome", outcome.outcomeId)],
								metadata: { audience: policy.audience, status: outcome.kind },
							},
						} satisfies ExecutorOutcomeViewFact,
					],
				]);
				for (const issue of projection.issues) {
					ctx.down([["DATA", { kind: "issue", issue } satisfies ExecutorOutcomeViewFact]]);
				}
			}
		},
		{ name: `${name}/runtime`, factory: "executorOutcomeViewProjector" },
	);
	return {
		views: projectRuntimeFact(graph, runtime, `${name}/views`, "executorOutcomeViews", (fact) =>
			fact.kind === "view" ? fact.view : undefined,
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"executorOutcomeViewIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"executorOutcomeViewAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
	};
}

export function structuredAgentDecisionInterpreter(
	graph: Graph,
	outcomes: Node<ExecutorOutcome>,
	opts: {
		readonly name?: string;
		readonly schemaRef?: string;
		readonly requestFacts?: readonly Node<AgentRequestFact>[];
	} = {},
): StructuredAgentDecisionInterpreterBundle {
	const name = opts.name ?? "structuredAgentDecisionInterpreter";
	const requestFacts = opts.requestFacts ?? [];
	const runtime = graph.node<StructuredAgentDecisionInterpreterFact>(
		[outcomes, ...requestFacts],
		(ctx) => {
			const state = ctx.state.get<StructuredInterpreterState>() ?? {
				requests: new Map<string, AgentRequestIssued>(),
				issueSeq: 0,
			};
			forEachDepBatch(ctx, 1, requestFacts.length, (raw) => {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "issued") state.requests.set(fact.requestId, fact);
			});
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = raw as ExecutorOutcome;
				if (outcome.kind !== "result") {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"non-result-outcome",
						"Only result outcomes can carry AgentDecision envelopes",
					);
					continue;
				}
				const value = outcome.result.value;
				if (!isRecord(value)) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"malformed-agent-decision",
						"ExecutorOutcome result must carry a structured agent-decision envelope",
					);
					continue;
				}
				const envelope = value as Partial<StructuredAgentDecisionEnvelope>;
				if (envelope.kind !== "agent-decision" || !isRecord(envelope.decision)) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"malformed-agent-decision",
						"Structured agent-decision envelope is missing kind or decision",
					);
					continue;
				}
				if (typeof envelope.schemaRef !== "string" || envelope.schemaRef.length === 0) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"missing-agent-decision-schema",
						"Structured agent-decision envelope must carry schemaRef evidence",
					);
					continue;
				}
				if (opts.schemaRef !== undefined && envelope.schemaRef !== opts.schemaRef) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"agent-decision-schema-mismatch",
						"Structured agent-decision envelope schemaRef did not match",
					);
					continue;
				}
				const decision = validateAgentDecision(envelope.decision, outcome);
				if (typeof decision === "string") {
					state.issueSeq += 1;
					emitInterpreterIssue(ctx, state.issueSeq, outcome, "malformed-agent-decision", decision);
					continue;
				}
				const request = state.requests.get(decision.source.requestId);
				if (request === undefined) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"missing-agent-decision-request",
						"AgentDecision source request must be present in the request ledger",
					);
					continue;
				}
				if (
					request.effectRunId !== decision.effectRunId ||
					request.operationId !== decision.source.operationId
				) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"stale-agent-decision-source",
						"AgentDecision source request/effectRun/operation identity did not match the request ledger",
					);
					continue;
				}
				ctx.down([
					["DATA", { kind: "decision", decision } satisfies StructuredAgentDecisionInterpreterFact],
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: `${outcome.outcomeId}:agent-decision-interpreted`,
								kind: "agent-decision-interpreted",
								subjectId: decision.effectRunId,
								sourceRefs: [ref("executor-outcome", outcome.outcomeId)],
							},
						} satisfies StructuredAgentDecisionInterpreterFact,
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "structuredAgentDecisionInterpreter" },
	);
	return {
		decisions: projectRuntimeFact(
			graph,
			runtime,
			`${name}/decisions`,
			"structuredAgentDecisions",
			(fact) => (fact.kind === "decision" ? fact.decision : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"structuredAgentDecisionIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"structuredAgentDecisionAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
	};
}

export function effectRunCompletionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly effectRuns: Node<EffectRun>;
		readonly decisions?: readonly Node<AgentDecision>[];
		readonly requestStatuses?: readonly Node<AgentRequestStatusChanged>[];
		readonly requestFacts?: readonly Node<AgentRequestFact>[];
		readonly resultCandidates?: readonly Node<EffectRunResult>[];
		readonly now?: () => number;
	},
): EffectRunCompletionBundle {
	const name = opts.name ?? "effectRunCompletion";
	const decisions = opts.decisions ?? [];
	const requestStatuses = opts.requestStatuses ?? [];
	const requestFacts = opts.requestFacts ?? [];
	const resultCandidates = opts.resultCandidates ?? [];
	const deps = [
		opts.effectRuns,
		...decisions,
		...requestStatuses,
		...requestFacts,
		...resultCandidates,
	];
	const decisionStart = 1;
	const requestStatusStart = decisionStart + decisions.length;
	const requestFactStart = requestStatusStart + requestStatuses.length;
	const resultCandidateStart = requestFactStart + requestFacts.length;
	const now = opts.now ?? Date.now;
	const runtime = graph.node<EffectRunCompletionFact>(
		deps,
		(ctx) => {
			const state = ctx.state.get<EffectRunCompletionState>() ?? emptyEffectRunCompletionState();
			const touchedEffectRunIds = new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const run = raw as EffectRun;
				state.runs.set(run.effectRunId, run);
				touchedEffectRunIds.add(run.effectRunId);
			}
			forEachDepBatch(ctx, requestFactStart, requestFacts.length, (raw) => {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "issued") {
					state.requests.set(fact.requestId, fact);
					touchedEffectRunIds.add(fact.effectRunId);
					const existingStatus = state.statusByRequest.get(fact.requestId);
					if (existingStatus !== undefined && !statusMatchesRequest(existingStatus, fact)) {
						emitEffectRunIssue(
							ctx,
							state,
							"stale-request-status",
							`AgentRequest status for '${fact.requestId}' did not match its issued effectRun/operation identity`,
							fact.effectRunId,
							[ref("agent-request", fact.requestId)],
						);
					}
					const result = state.resultsByEffectRun.get(fact.effectRunId);
					if (result !== undefined && fact.required) {
						state.issueSeq += 1;
						const issue = dataIssue(
							"late-required-request-after-effect-run-result",
							`Required request '${fact.requestId}' arrived after EffectRun '${fact.effectRunId}' already had a terminal result`,
							{
								subjectId: fact.effectRunId,
								refs: [
									ref("agent-request", fact.requestId),
									ref("effect-run-result", result.resultId),
								],
							},
						);
						ctx.down([
							["DATA", { kind: "issue", issue } satisfies EffectRunCompletionFact],
							[
								"DATA",
								{
									kind: "audit",
									audit: {
										id: `${fact.effectRunId}:late-required-request:${state.issueSeq}`,
										kind: "late-required-request-after-effect-run-result",
										subjectId: fact.effectRunId,
										issueCode: issue.code,
										sourceRefs: [
											ref("agent-request", fact.requestId),
											ref("effect-run-result", result.resultId),
										],
									},
								} satisfies EffectRunCompletionFact,
							],
						]);
					}
				} else if (fact.kind === "status") {
					acceptRequestStatus(ctx, state, fact);
					touchedEffectRunIds.add(fact.effectRunId);
				}
			});
			forEachDepBatch(ctx, requestStatusStart, requestStatuses.length, (raw) => {
				const status = raw as AgentRequestStatusChanged;
				acceptRequestStatus(ctx, state, status);
				touchedEffectRunIds.add(status.effectRunId);
			});
			forEachDepBatch(ctx, resultCandidateStart, resultCandidates.length, (raw) => {
				acceptEffectRunResultCandidate(ctx, state, raw as EffectRunResult);
			});
			forEachDepBatch(ctx, decisionStart, decisions.length, (raw) => {
				const decision = raw as AgentDecision;
				state.decisions.set(decision.decisionId, decision);
				touchedEffectRunIds.add(decision.effectRunId);
			});
			for (const decision of state.decisions.values()) {
				if (state.resultsByEffectRun.has(decision.effectRunId)) continue;
				const candidate = candidateFromDecision(decision, state, now());
				if (candidate === undefined) continue;
				acceptEffectRunResultCandidate(ctx, state, candidate);
			}
			for (const effectRunId of touchedEffectRunIds) {
				if (!state.resultsByEffectRun.has(effectRunId)) {
					emitEffectRunStatus(
						ctx,
						effectRunId,
						"pending",
						requiredPendingRequests(effectRunId, state),
						requiredTerminalRequests(effectRunId, state),
					);
				}
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "effectRunCompletionProjector" },
	);
	return {
		results: projectRuntimeFact(
			graph,
			runtime,
			`${name}/results`,
			"effectRunCompletionResults",
			(fact) => (fact.kind === "result" ? fact.result : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"effectRunCompletionStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"effectRunCompletionIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"effectRunCompletionAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
	};
}

export function fakeExecutorResult<T>(
	opts: Omit<ExecutorOutcomeBase, "kind"> & { readonly result: AgentOutputEnvelope<T> },
): ExecutorOutcome<T> {
	return { kind: "result", ...opts };
}

export function fakeExecutorFailure(
	opts: Omit<ExecutorOutcomeBase, "kind"> & {
		readonly error: DataIssue;
		readonly retryable?: boolean;
	},
): ExecutorOutcome {
	return { kind: "failure", ...opts };
}

export function fakeExecutorBlocked(
	opts: Omit<ExecutorOutcomeBase, "kind"> & { readonly needs: readonly AgentNeed[] },
): ExecutorOutcome {
	return { kind: "blocked", ...opts };
}

export function fakeExecutorTimeout(
	opts: Omit<ExecutorOutcomeBase, "kind"> & {
		readonly timeoutMs?: number;
		readonly retryable?: boolean;
	},
): ExecutorOutcome {
	return { kind: "timeout", ...opts };
}

export function fakeExecutorCanceled(
	opts: Omit<ExecutorOutcomeBase, "kind"> & { readonly reason?: string },
): ExecutorOutcome {
	return { kind: "canceled", ...opts };
}

type AgentRequestSatisfactionFact =
	| { readonly kind: "status"; readonly status: AgentRequestStatusChanged }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

type ToolProviderPolicyResolutionFact =
	| { readonly kind: "resolution"; readonly resolution: ToolProviderPolicyResolution }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

type ToolProviderAdapterInputFact =
	| { readonly kind: "input"; readonly input: ToolProviderAdapterInput }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

type ExecutorOutcomeViewFact =
	| { readonly kind: "view"; readonly view: ExecutorOutcomeView }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

interface ExecutorOutcomeViewProjection {
	readonly view: ExecutorOutcomeView;
	readonly issues: readonly DataIssue[];
}

interface ExecutorOutcomeSummaryProjection {
	readonly summary: string;
	readonly truncated: boolean;
	readonly originalChars: number;
	readonly limitChars: number;
}

type StructuredAgentDecisionInterpreterFact =
	| { readonly kind: "decision"; readonly decision: AgentDecision }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

type EffectRunCompletionFact =
	| { readonly kind: "result"; readonly result: EffectRunResult }
	| { readonly kind: "status"; readonly status: EffectRunCompletionStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

interface AgentRequestViewsState {
	requestsById: Map<string, AgentRequestIssued>;
	requestsByEffectRun: Map<string, string[]>;
	statusByRequest: Map<string, AgentRequestStatusChanged>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
	auditSeq: number;
}

interface EffectRunCompletionState {
	runs: Map<string, EffectRun>;
	requests: Map<string, AgentRequestIssued>;
	statusByRequest: Map<string, AgentRequestStatusChanged>;
	decisions: Map<string, AgentDecision>;
	resultsByEffectRun: Map<string, EffectRunResult>;
	issueSeq: number;
}

interface StructuredInterpreterState {
	requests: Map<string, AgentRequestIssued>;
	issueSeq: number;
}

interface ToolProviderPolicyResolutionState {
	requests: Map<string, AgentRequestIssued>;
	routes: Map<string, ExecutorRoute>;
	catalogs: Map<string, ToolProviderCatalog>;
	emittedKeys: Set<string>;
	auditSeq: number;
}

interface ToolProviderAdapterInputState {
	requests: Map<string, AgentRequestIssued>;
	routes: Map<string, ExecutorRoute>;
	catalogs: Map<string, ToolProviderCatalog>;
	resolutions: Map<string, ToolProviderPolicyResolution>;
	emittedKeys: Set<string>;
	auditSeq: number;
}

function initialRequestStatus(request: AgentRequestIssued): AgentRequestStatus {
	if (request.requestKind === "context") return "awaiting-context";
	if (request.requestKind === "prompt") return "awaiting-prompt";
	return "awaiting-route";
}

function evaluateRequestSatisfaction(ctx: Ctx, state: RequestSatisfactionState): void {
	for (const route of state.routes.values()) handleRoute(ctx, state, route);
	for (const contribution of state.contexts.values())
		handleContextContribution(ctx, state, contribution);
	for (const prompt of state.prompts.values()) handlePromptBundle(ctx, state, prompt);
	for (const outcome of state.outcomes.values()) handleExecutorOutcome(ctx, state, outcome);
}

function handleRoute(ctx: Ctx, state: RequestSatisfactionState, route: ExecutorRoute): void {
	const request = state.requests.get(route.requestId);
	if (request === undefined) {
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (state.compatibleRoutesByRouteId.get(route.routeId)?.requestId !== request.requestId) {
			emitIssueOnce(
				ctx,
				state,
				`late-route:${route.routeId}`,
				"late-route-after-terminal",
				`ExecutorRoute '${route.routeId}' arrived after request '${request.requestId}' was already terminal`,
				request.requestId,
				[ref("executor-route", route.routeId), ref("agent-request", request.requestId)],
			);
		}
		return;
	}
	if (request.operationId !== route.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-route:${route.routeId}`,
			"stale-route-operation",
			`ExecutorRoute '${route.routeId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("executor-route", route.routeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	const profile = state.profiles.get(route.profileId);
	if (profile === undefined) {
		return;
	}
	const compatibilityIssue = routeCompatibilityIssue(request, route, profile);
	if (compatibilityIssue !== undefined) {
		emitIssueOnce(
			ctx,
			state,
			`route-incompatible:${route.routeId}:${compatibilityIssue}`,
			compatibilityIssue,
			`ExecutorRoute '${route.routeId}' is incompatible with request '${request.requestId}'`,
			request.requestId,
			[
				ref("executor-route", route.routeId),
				ref("executor-profile", profile.profileId),
				ref("agent-request", request.requestId),
			],
		);
		return;
	}
	state.compatibleRoutesByRouteId.set(route.routeId, route);
	emitStatusOnce(
		ctx,
		state,
		`route:${route.routeId}:awaiting-provider`,
		request,
		"awaiting-provider",
		[
			ref("executor-route", route.routeId),
			ref("executor-profile", profile.profileId),
			ref("agent-request", request.requestId),
		],
	);
}

function handleExecutorOutcome(
	ctx: Ctx,
	state: RequestSatisfactionState,
	outcome: ExecutorOutcome,
): void {
	const request = state.requests.get(outcome.requestId);
	if (request === undefined) {
		return;
	}
	if (request.operationId !== outcome.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-outcome:${outcome.outcomeId}`,
			"stale-outcome-operation",
			`ExecutorOutcome '${outcome.outcomeId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("executor-outcome", outcome.outcomeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	const route = state.compatibleRoutesByRouteId.get(outcome.routeId);
	if (route === undefined || route.requestId !== request.requestId) {
		emitIssueOnce(
			ctx,
			state,
			`missing-route:${outcome.outcomeId}`,
			"missing-compatible-route",
			`ExecutorOutcome '${outcome.outcomeId}' has no compatible route for request '${request.requestId}'`,
			request.requestId,
			[ref("executor-outcome", outcome.outcomeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	const outcomeIssue = outcomeCompatibilityIssue(request, route, outcome);
	if (outcomeIssue !== undefined) {
		emitIssueOnce(
			ctx,
			state,
			`outcome-incompatible:${outcome.outcomeId}:${outcomeIssue}`,
			outcomeIssue,
			`ExecutorOutcome '${outcome.outcomeId}' is incompatible with route '${route.routeId}' for request '${request.requestId}'`,
			request.requestId,
			[
				ref("executor-outcome", outcome.outcomeId),
				ref("executor-route", route.routeId),
				ref("agent-request", request.requestId),
			],
		);
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (state.acceptedTerminalFactIds.has(`outcome:${outcome.outcomeId}`)) return;
		emitIssueOnce(
			ctx,
			state,
			`duplicate-outcome:${outcome.outcomeId}`,
			"duplicate-terminal-outcome",
			`ExecutorOutcome '${outcome.outcomeId}' arrived after request '${request.requestId}' was already terminal`,
			request.requestId,
			[ref("executor-outcome", outcome.outcomeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	state.terminalRequests.add(request.requestId);
	state.acceptedTerminalFactIds.add(`outcome:${outcome.outcomeId}`);
	const status = outcomeStatus(outcome);
	emitStatus(ctx, state, request, status, [
		ref("executor-outcome", outcome.outcomeId),
		ref("executor-route", route.routeId),
		ref("agent-request", request.requestId),
	]);
}

function handleContextContribution(
	ctx: Ctx,
	state: RequestSatisfactionState,
	contribution: ContextContribution,
): void {
	const request = state.requests.get(contribution.requestId);
	if (request === undefined) return;
	if (request.operationId !== contribution.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-context:${contribution.contributionId}`,
			"stale-context-operation",
			`ContextContribution '${contribution.contributionId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("context-contribution", contribution.contributionId)],
		);
		return;
	}
	if (request.requestKind !== "context") {
		emitIssueOnce(
			ctx,
			state,
			`wrong-context-kind:${contribution.contributionId}`,
			"wrong-kind-context-satisfaction",
			`ContextContribution '${contribution.contributionId}' cannot satisfy ${request.requestKind} request '${request.requestId}'`,
			request.requestId,
			[ref("context-contribution", contribution.contributionId)],
		);
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (
			state.acceptedTerminalFactIds.has(`context:${contribution.contributionId}`) ||
			state.statusKeys.has(`context:${contribution.contributionId}:awaiting-context`)
		) {
			return;
		}
		emitIssueOnce(
			ctx,
			state,
			`duplicate-context:${contribution.contributionId}`,
			"duplicate-terminal-context",
			`ContextContribution '${contribution.contributionId}' arrived after request '${request.requestId}' was already terminal`,
			request.requestId,
			[
				ref("context-contribution", contribution.contributionId),
				ref("agent-request", request.requestId),
			],
		);
		return;
	}
	if (contribution.status === "pending")
		emitStatusOnce(
			ctx,
			state,
			`context:${contribution.contributionId}:awaiting-context`,
			request,
			"awaiting-context",
			[ref("context-contribution", contribution.contributionId)],
		);
	else {
		state.terminalRequests.add(request.requestId);
		state.acceptedTerminalFactIds.add(`context:${contribution.contributionId}`);
		emitStatus(
			ctx,
			state,
			request,
			contribution.status === "ready" ? "completed" : "failed",
			[ref("context-contribution", contribution.contributionId)],
			contribution.issues,
		);
	}
}

function handlePromptBundle(ctx: Ctx, state: RequestSatisfactionState, prompt: PromptBundle): void {
	const request = state.requests.get(prompt.requestId);
	if (request === undefined) return;
	if (request.operationId !== prompt.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-prompt:${prompt.promptId}`,
			"stale-prompt-operation",
			`PromptBundle '${prompt.promptId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("prompt-bundle", prompt.promptId)],
		);
		return;
	}
	if (request.requestKind !== "prompt") {
		emitIssueOnce(
			ctx,
			state,
			`wrong-prompt-kind:${prompt.promptId}`,
			"wrong-kind-prompt-satisfaction",
			`PromptBundle '${prompt.promptId}' cannot satisfy ${request.requestKind} request '${request.requestId}'`,
			request.requestId,
			[ref("prompt-bundle", prompt.promptId)],
		);
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (
			state.acceptedTerminalFactIds.has(`prompt:${prompt.promptId}`) ||
			state.statusKeys.has(`prompt:${prompt.promptId}:awaiting-prompt`)
		) {
			return;
		}
		emitIssueOnce(
			ctx,
			state,
			`duplicate-prompt:${prompt.promptId}`,
			"duplicate-terminal-prompt",
			`PromptBundle '${prompt.promptId}' arrived after request '${request.requestId}' was already terminal`,
			request.requestId,
			[ref("prompt-bundle", prompt.promptId), ref("agent-request", request.requestId)],
		);
		return;
	}
	if (prompt.status === "ready") {
		state.terminalRequests.add(request.requestId);
		state.acceptedTerminalFactIds.add(`prompt:${prompt.promptId}`);
		emitStatus(ctx, state, request, "completed", [ref("prompt-bundle", prompt.promptId)]);
	} else if (prompt.status === "issue") {
		state.terminalRequests.add(request.requestId);
		state.acceptedTerminalFactIds.add(`prompt:${prompt.promptId}`);
		emitStatus(
			ctx,
			state,
			request,
			"failed",
			[ref("prompt-bundle", prompt.promptId)],
			prompt.issues,
		);
	} else {
		emitStatusOnce(
			ctx,
			state,
			`prompt:${prompt.promptId}:awaiting-prompt`,
			request,
			"awaiting-prompt",
			[ref("prompt-bundle", prompt.promptId)],
			prompt.issues,
		);
	}
}

function routeCompatibilityIssue(
	request: AgentRequestIssued,
	route: ExecutorRoute,
	profile: ExecutorProfile,
): string | undefined {
	if (request.requestKind !== "executor") return "route-for-non-executor-request";
	if (route.executorId !== profile.executorId) return "route-profile-executor-mismatch";
	if (
		request.input?.inputId !== undefined &&
		route.inputId !== undefined &&
		request.input.inputId !== route.inputId
	) {
		return "route-input-mismatch";
	}
	if (
		request.input?.inputKind !== undefined &&
		route.inputKind !== undefined &&
		request.input.inputKind !== route.inputKind
	) {
		return "route-input-kind-mismatch";
	}
	const inputKind = request.input?.inputKind ?? route.inputKind;
	if (inputKind !== undefined && !profileKindAcceptsInput(profile.kind, inputKind))
		return "profile-kind-input-incompatible";
	if (
		inputKind !== undefined &&
		profile.acceptedInputKinds !== undefined &&
		!profile.acceptedInputKinds.includes(inputKind)
	) {
		return "profile-rejects-input-kind";
	}
	if (
		request.input?.schemaRef !== undefined &&
		profile.acceptedSchemaRefs !== undefined &&
		!profile.acceptedSchemaRefs.includes(request.input.schemaRef)
	) {
		return "profile-rejects-schema";
	}
	return undefined;
}

function outcomeCompatibilityIssue(
	request: AgentRequestIssued,
	route: ExecutorRoute,
	outcome: ExecutorOutcome,
): string | undefined {
	if (outcome.executorId !== route.executorId) return "outcome-route-executor-mismatch";
	if (outcome.profileId !== route.profileId) return "outcome-route-profile-mismatch";
	if (
		route.inputId !== undefined &&
		(outcome.inputId === undefined || outcome.inputId !== route.inputId)
	) {
		return "outcome-route-input-mismatch";
	}
	if (
		request.input?.inputId !== undefined &&
		outcome.inputId !== undefined &&
		outcome.inputId !== request.input.inputId
	) {
		return "outcome-request-input-mismatch";
	}
	if (
		route.inputKind !== undefined &&
		(outcome.inputKind === undefined || outcome.inputKind !== route.inputKind)
	) {
		return "outcome-route-input-kind-mismatch";
	}
	if (
		request.input?.inputKind !== undefined &&
		outcome.inputKind !== undefined &&
		outcome.inputKind !== request.input.inputKind
	) {
		return "outcome-request-input-kind-mismatch";
	}
	return undefined;
}

function profileKindAcceptsInput(kind: ExecutorProfile["kind"], inputKind: string): boolean {
	if (kind === "llm") return inputKind === "llm-call";
	if (kind === "tool") return inputKind === "tool-call";
	if (kind === "human") return inputKind === "human-task";
	return inputKind === "agent-task";
}

function outcomeStatus(outcome: ExecutorOutcome): AgentRequestStatus {
	if (outcome.kind === "result") return "completed";
	if (outcome.kind === "failure") return "failed";
	if (outcome.kind === "timeout") return "timeout";
	if (outcome.kind === "canceled") return "canceled";
	return "blocked";
}

function executorOutcomeViewProjectionFromOutcome(
	outcome: ExecutorOutcome,
	policy: Required<ExecutorOutcomeViewPolicy>,
): ExecutorOutcomeViewProjection {
	const sourceRefs = uniqueSourceRefs([
		ref("executor-outcome", outcome.outcomeId),
		...(outcome.evidenceRefs ?? []),
	]);
	const summary = projectOutcomeSummary(outcome, policy.maxSummaryChars);
	const issues = Object.freeze([
		...outcomeIssues(outcome),
		...(summary.truncated ? [outcomeSummaryTruncationIssue(outcome, summary, policy)] : []),
	]);
	const view = Object.freeze({
		kind: "executor-outcome-view",
		viewId: `${outcome.outcomeId}:${policy.audience}`,
		audience: policy.audience,
		outcomeId: outcome.outcomeId,
		requestId: outcome.requestId,
		operationId: outcome.operationId,
		routeId: outcome.routeId,
		executorId: outcome.executorId,
		profileId: outcome.profileId,
		status: outcome.kind,
		summary: summary.summary,
		summaryTruncated: summary.truncated,
		summaryChars: summary.originalChars,
		summaryLimitChars: summary.limitChars,
		errorKind: outcomeErrorKind(outcome),
		retryable: outcomeRetryable(outcome),
		nextActions: outcomeNextActions(outcome),
		sourceRefs,
		materialRefs: outcomeMaterialRefs(outcome),
		issues: policy.includeIssues && issues.length > 0 ? issues : undefined,
		usage: policy.includeUsage ? outcome.usage : undefined,
		metadata: policy.includeMetadata ? outcome.metadata : undefined,
	} satisfies ExecutorOutcomeView);
	return Object.freeze({ view, issues });
}

function projectOutcomeSummary(
	outcome: ExecutorOutcome,
	maxChars: number,
): ExecutorOutcomeSummaryProjection {
	const summary = outcomeSummary(outcome);
	const limitChars = Math.max(0, maxChars);
	if (summary.length <= limitChars) {
		return Object.freeze({
			summary,
			truncated: false,
			originalChars: summary.length,
			limitChars,
		});
	}
	const bounded =
		limitChars <= 1
			? summary.slice(0, limitChars)
			: limitChars <= 3
				? summary.slice(0, limitChars)
				: `${summary.slice(0, limitChars - 3)}...`;
	return Object.freeze({
		summary: bounded,
		truncated: true,
		originalChars: summary.length,
		limitChars,
	});
}

function outcomeSummaryTruncationIssue(
	outcome: ExecutorOutcome,
	summary: ExecutorOutcomeSummaryProjection,
	policy: Required<ExecutorOutcomeViewPolicy>,
): DataIssue {
	return dataIssue(
		"executor-outcome-view-summary-truncated",
		"ExecutorOutcome view summary was truncated; inspect material refs or the source outcome for full detail",
		{
			subjectId: outcome.requestId,
			refs: [ref("executor-outcome", outcome.outcomeId)],
			severity: "warning",
			details: {
				audience: policy.audience,
				outcomeId: outcome.outcomeId,
				originalChars: summary.originalChars,
				limitChars: summary.limitChars,
			},
		},
	);
}

function outcomeSummary(outcome: ExecutorOutcome): string {
	if (outcome.kind === "result") {
		if (outcome.result.summary !== undefined && outcome.result.summary.length > 0)
			return outcome.result.summary;
		return `Executor result '${outcome.result.kind}' is available via source refs`;
	}
	if (outcome.kind === "failure") return outcome.error.message;
	if (outcome.kind === "blocked") {
		const needKinds = outcome.needs.map((need) => need.kind).join(", ");
		return needKinds.length > 0 ? `Executor blocked: ${needKinds}` : "Executor blocked";
	}
	if (outcome.kind === "timeout") {
		return outcome.timeoutMs === undefined
			? "Executor timed out"
			: `Executor timed out after ${outcome.timeoutMs}ms`;
	}
	return outcome.reason ?? "Executor canceled";
}

function outcomeErrorKind(outcome: ExecutorOutcome): string | undefined {
	if (outcome.kind === "failure") return outcome.error.code;
	if (outcome.kind === "timeout") return "timeout";
	if (outcome.kind === "blocked") return outcome.needs[0]?.kind ?? "blocked";
	if (outcome.kind === "canceled") return "canceled";
	return undefined;
}

function outcomeRetryable(outcome: ExecutorOutcome): boolean | undefined {
	if (outcome.kind === "failure" || outcome.kind === "timeout") return outcome.retryable;
	return undefined;
}

function outcomeIssues(outcome: ExecutorOutcome): readonly DataIssue[] {
	if (outcome.kind === "failure") return Object.freeze([outcome.error, ...(outcome.issues ?? [])]);
	return outcome.issues ?? [];
}

function outcomeNextActions(outcome: ExecutorOutcome): readonly string[] | undefined {
	if (outcome.kind === "blocked") return Object.freeze(outcome.needs.map((need) => need.kind));
	if ((outcome.kind === "failure" || outcome.kind === "timeout") && outcome.retryable === true) {
		return Object.freeze(["retry-or-route"]);
	}
	return undefined;
}

function outcomeMaterialRefs(outcome: ExecutorOutcome): readonly SourceRef[] | undefined {
	const refs =
		outcome.kind === "result"
			? [...(outcome.result.refs ?? [])]
			: outcome.kind === "blocked"
				? outcome.needs.flatMap((need) => [...(need.refs ?? [])])
				: [];
	return refs.length === 0 ? undefined : uniqueSourceRefs(refs);
}

function uniqueSourceRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
	const seen = new Set<string>();
	const unique: SourceRef[] = [];
	for (const sourceRef of sourceRefs) {
		const key = `${sourceRef.kind}:${sourceRef.id}:${JSON.stringify(sourceRef.metadata ?? {})}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(sourceRef);
	}
	return Object.freeze(unique);
}

function stableJsonStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(value, (_key, child) => {
		if (typeof child === "bigint") return child.toString();
		if (typeof child === "function") return "[Function]";
		if (!isRecord(child) && !Array.isArray(child)) return child;
		if (seen.has(child)) return "[Circular]";
		seen.add(child);
		if (Array.isArray(child)) return child;
		return Object.keys(child)
			.sort()
			.reduce<Record<string, unknown>>((out, key) => {
				out[key] = child[key];
				return out;
			}, {});
	});
}

function emitStatus(
	ctx: Ctx,
	state: RequestSatisfactionState,
	request: AgentRequestIssued,
	status: AgentRequestStatus,
	sourceRefs?: readonly SourceRef[],
	issues?: readonly DataIssue[],
): void {
	const fact: AgentRequestStatusChanged = {
		kind: "status",
		requestId: request.requestId,
		operationId: request.operationId,
		effectRunId: request.effectRunId,
		status,
		sourceRefs,
		issues,
	};
	state.auditSeq += 1;
	ctx.down([
		["DATA", { kind: "status", status: fact } satisfies AgentRequestSatisfactionFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${request.requestId}:status:${state.auditSeq}`,
					kind: "agent-request-status",
					subjectId: request.requestId,
					sourceRefs,
					metadata: { status },
				},
			} satisfies AgentRequestSatisfactionFact,
		],
	]);
}

function emitStatusOnce(
	ctx: Ctx,
	state: RequestSatisfactionState,
	key: string,
	request: AgentRequestIssued,
	status: AgentRequestStatus,
	sourceRefs?: readonly SourceRef[],
	issues?: readonly DataIssue[],
): void {
	if (state.statusKeys.has(key)) return;
	state.statusKeys.add(key);
	emitStatus(ctx, state, request, status, sourceRefs, issues);
}

function emitIssue(
	ctx: Ctx,
	state: RequestSatisfactionState,
	code: string,
	message: string,
	subjectId?: string,
	refs?: readonly SourceRef[],
): void {
	state.issueSeq += 1;
	const issue = dataIssue(code, message, { subjectId, refs });
	state.auditSeq += 1;
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies AgentRequestSatisfactionFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${subjectId ?? "request"}:issue:${state.auditSeq}`,
					kind: "agent-request-issue",
					subjectId,
					issueCode: code,
					message,
					sourceRefs: refs,
				},
			} satisfies AgentRequestSatisfactionFact,
		],
	]);
}

function emitIssueOnce(
	ctx: Ctx,
	state: RequestSatisfactionState,
	key: string,
	code: string,
	message: string,
	subjectId?: string,
	refs?: readonly SourceRef[],
): void {
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	emitIssue(ctx, state, code, message, subjectId, refs);
}

function emitInterpreterIssue(
	ctx: Ctx,
	seq: number,
	outcome: ExecutorOutcome,
	code: string,
	message: string,
): void {
	const issue = dataIssue(code, message, {
		subjectId: outcome.requestId,
		refs: [ref("executor-outcome", outcome.outcomeId)],
	});
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies StructuredAgentDecisionInterpreterFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${outcome.outcomeId}:agent-decision-issue:${seq}`,
					kind: "agent-decision-issue",
					subjectId: outcome.requestId,
					issueCode: code,
					message,
					sourceRefs: [ref("executor-outcome", outcome.outcomeId)],
				},
			} satisfies StructuredAgentDecisionInterpreterFact,
		],
	]);
}

function validateAgentDecision(raw: unknown, outcome: ExecutorOutcome): AgentDecision | string {
	if (!isRecord(raw)) return "AgentDecision must be an object";
	const kind = raw.kind;
	if (kind !== "continue" && kind !== "final" && kind !== "blocked") {
		return "AgentDecision kind must be continue, final, or blocked";
	}
	if (typeof raw.decisionId !== "string" || raw.decisionId.length === 0)
		return "AgentDecision decisionId must be a non-empty string";
	if (
		raw.effectRunId === undefined ||
		typeof raw.effectRunId !== "string" ||
		raw.effectRunId.length === 0
	)
		return "AgentDecision effectRunId must be a non-empty string";
	if (typeof raw.agentRunId !== "string" || raw.agentRunId.length === 0)
		return "AgentDecision agentRunId must be a non-empty string";
	const source = raw.source;
	if (
		!isRecord(source) ||
		source.requestId !== outcome.requestId ||
		source.operationId !== outcome.operationId ||
		source.outcomeId !== outcome.outcomeId
	) {
		return "AgentDecision source must match the ExecutorOutcome requestId, operationId, and outcomeId";
	}
	if (kind === "continue") {
		if (!Array.isArray(raw.next)) return "AgentDecision.continue next must be an array";
		for (const proposal of raw.next) {
			if (!isAgentRequestProposalLike(proposal, raw.effectRunId)) {
				return "AgentDecision.continue next entries must be AgentRequestProposal-like objects";
			}
		}
		return raw as unknown as AgentDecisionContinue;
	}
	if (kind === "final") {
		if (!isRecord(raw.output) || typeof raw.output.kind !== "string")
			return "AgentDecision.final output must be an envelope with kind";
		return raw as unknown as AgentDecisionFinal;
	}
	if (!Array.isArray(raw.needs)) return "AgentDecision.blocked needs must be an array";
	for (const need of raw.needs) {
		if (!isAgentNeedLike(need))
			return "AgentDecision.blocked needs entries must be AgentNeed-like objects";
	}
	return raw as unknown as AgentDecisionBlocked;
}

function isAgentRequestProposalLike(value: unknown, effectRunId: string): boolean {
	if (!isRecord(value)) return false;
	if (value.kind !== "proposal") return false;
	if (typeof value.proposalId !== "string" || value.proposalId.length === 0) return false;
	if (value.effectRunId !== effectRunId) return false;
	return (
		value.requestKind === "context" ||
		value.requestKind === "prompt" ||
		value.requestKind === "executor"
	);
}

function isAgentNeedLike(value: unknown): boolean {
	return isRecord(value) && typeof value.kind === "string" && value.kind.length > 0;
}

function candidateFromDecision(
	decision: AgentDecision,
	state: EffectRunCompletionState,
	completedAtMs: number,
): EffectRunResult | undefined {
	const run = state.runs.get(decision.effectRunId);
	if (run === undefined) return undefined;
	if (!decisionSourceRequestTerminal(decision, state)) return undefined;
	const requiredPending = requiredPendingRequests(decision.effectRunId, state);
	if (decision.kind === "final") {
		if (requiredPending.length > 0) {
			return undefined;
		}
		return {
			kind: "effect-run-result",
			resultId: `${decision.effectRunId}:result`,
			status: "completed",
			effectRunId: decision.effectRunId,
			subjectRefs: run.subjectRefs,
			operationId: decision.source.operationId,
			sourceRefs: [
				ref("agent-decision", decision.decisionId),
				ref("executor-outcome", decision.source.outcomeId),
			],
			completedAtMs,
			output: decision.output,
		};
	}
	if (decision.kind === "blocked" && requiredPending.length === 0) {
		return {
			kind: "effect-run-result",
			resultId: `${decision.effectRunId}:result`,
			status: "blocked",
			effectRunId: decision.effectRunId,
			subjectRefs: run.subjectRefs,
			operationId: decision.source.operationId,
			sourceRefs: [
				ref("agent-decision", decision.decisionId),
				ref("executor-outcome", decision.source.outcomeId),
			],
			completedAtMs,
			needs: decision.needs,
		};
	}
	return undefined;
}

function acceptEffectRunResultCandidate(
	ctx: Ctx,
	state: EffectRunCompletionState,
	candidate: EffectRunResult,
): void {
	if (!state.runs.has(candidate.effectRunId)) {
		emitEffectRunIssue(
			ctx,
			state,
			"unknown-effect-run-result-candidate",
			`EffectRunResult candidate '${candidate.resultId}' references unknown EffectRun '${candidate.effectRunId}'`,
			candidate.effectRunId,
			candidate.sourceRefs,
		);
		return;
	}
	const existing = state.resultsByEffectRun.get(candidate.effectRunId);
	if (existing !== undefined) {
		state.issueSeq += 1;
		const duplicate = sameTerminalResult(existing, candidate);
		const code = duplicate ? "duplicate-effect-run-result" : "conflicting-effect-run-result";
		const issue = dataIssue(
			code,
			`EffectRun '${candidate.effectRunId}' already has a terminal result`,
			{
				subjectId: candidate.effectRunId,
				refs: candidate.sourceRefs,
			},
		);
		ctx.down([
			["DATA", { kind: "issue", issue } satisfies EffectRunCompletionFact],
			[
				"DATA",
				{
					kind: "audit",
					audit: {
						id: `${candidate.effectRunId}:${code}:${state.issueSeq}`,
						kind: duplicate ? "effect-run-result-duplicate" : "effect-run-result-conflict",
						subjectId: candidate.effectRunId,
						issueCode: issue.code,
						sourceRefs: candidate.sourceRefs,
					},
				} satisfies EffectRunCompletionFact,
			],
		]);
		return;
	}
	state.resultsByEffectRun.set(candidate.effectRunId, candidate);
	ctx.down([
		["DATA", { kind: "result", result: candidate } satisfies EffectRunCompletionFact],
		[
			"DATA",
			{
				kind: "status",
				status: {
					effectRunId: candidate.effectRunId,
					state: candidate.status,
					requiredPending: [],
					requiredTerminal: requiredTerminalRequests(candidate.effectRunId, state),
					sourceRefs: candidate.sourceRefs,
				},
			} satisfies EffectRunCompletionFact,
		],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${candidate.effectRunId}:terminal-result`,
					kind: "effect-run-terminal-result",
					subjectId: candidate.effectRunId,
					sourceRefs: candidate.sourceRefs,
					metadata: { status: candidate.status },
				},
			} satisfies EffectRunCompletionFact,
		],
	]);
}

function emitEffectRunStatus(
	ctx: Ctx,
	effectRunId: string,
	state: EffectRunCompletionStatus["state"],
	requiredPending: readonly string[],
	requiredTerminal: readonly string[],
): void {
	ctx.down([
		[
			"DATA",
			{
				kind: "status",
				status: { effectRunId, state, requiredPending, requiredTerminal },
			} satisfies EffectRunCompletionFact,
		],
	]);
}

function requiredPendingRequests(
	effectRunId: string,
	state: EffectRunCompletionState,
): readonly string[] {
	const pending: string[] = [];
	for (const request of state.requests.values()) {
		if (request.effectRunId !== effectRunId || !request.required) continue;
		const statusFact = matchingStatusForRequest(state, request);
		const status = statusFact?.status;
		if (status === undefined || !isTerminalRequestStatus(status)) pending.push(request.requestId);
	}
	return pending;
}

function requiredTerminalRequests(
	effectRunId: string,
	state: EffectRunCompletionState,
): readonly string[] {
	const terminal: string[] = [];
	for (const request of state.requests.values()) {
		if (request.effectRunId !== effectRunId || !request.required) continue;
		const statusFact = matchingStatusForRequest(state, request);
		const status = statusFact?.status;
		if (status !== undefined && isTerminalRequestStatus(status)) terminal.push(request.requestId);
	}
	return terminal;
}

function isTerminalRequestStatus(status: AgentRequestStatus): boolean {
	return (
		status === "completed" ||
		status === "failed" ||
		status === "blocked" ||
		status === "canceled" ||
		status === "timeout" ||
		status === "waived" ||
		status === "retry-exhausted"
	);
}

function decisionSourceRequestTerminal(
	decision: AgentDecision,
	state: EffectRunCompletionState,
): boolean {
	const request = state.requests.get(decision.source.requestId);
	if (request === undefined) return false;
	if (
		request.effectRunId !== decision.effectRunId ||
		request.operationId !== decision.source.operationId
	) {
		return false;
	}
	const status = matchingStatusForRequest(state, request)?.status;
	return status !== undefined && isTerminalRequestStatus(status);
}

function acceptRequestStatus(
	ctx: Ctx,
	state: EffectRunCompletionState,
	status: AgentRequestStatusChanged,
): void {
	const request = state.requests.get(status.requestId);
	if (request !== undefined && !statusMatchesRequest(status, request)) {
		emitEffectRunIssue(
			ctx,
			state,
			"stale-request-status",
			`AgentRequest status for '${status.requestId}' did not match its issued effectRun/operation identity`,
			request.effectRunId,
			[ref("agent-request", status.requestId)],
		);
		return;
	}
	state.statusByRequest.set(status.requestId, status);
}

function matchingStatusForRequest(
	state: EffectRunCompletionState,
	request: AgentRequestIssued,
): AgentRequestStatusChanged | undefined {
	const status = state.statusByRequest.get(request.requestId);
	if (status === undefined) return undefined;
	return statusMatchesRequest(status, request) ? status : undefined;
}

function statusMatchesRequest(
	status: AgentRequestStatusChanged,
	request: AgentRequestIssued,
): boolean {
	return (
		status.effectRunId === request.effectRunId &&
		(status.operationId === undefined || status.operationId === request.operationId)
	);
}

function emitEffectRunIssue(
	ctx: Ctx,
	state: EffectRunCompletionState,
	code: string,
	message: string,
	subjectId?: string,
	sourceRefs?: readonly SourceRef[],
): void {
	state.issueSeq += 1;
	const issue = dataIssue(code, message, { subjectId, refs: sourceRefs });
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies EffectRunCompletionFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${subjectId ?? "effect-run"}:${code}:${state.issueSeq}`,
					kind: "effect-run-issue",
					subjectId,
					issueCode: code,
					message,
					sourceRefs,
				},
			} satisfies EffectRunCompletionFact,
		],
	]);
}

function sameTerminalResult(a: EffectRunResult, b: EffectRunResult): boolean {
	return (
		a.status === b.status && a.resultId === b.resultId && JSON.stringify(a) === JSON.stringify(b)
	);
}

function emptyEffectRunCompletionState(): EffectRunCompletionState {
	return {
		runs: new Map<string, EffectRun>(),
		requests: new Map<string, AgentRequestIssued>(),
		statusByRequest: new Map<string, AgentRequestStatusChanged>(),
		decisions: new Map<string, AgentDecision>(),
		resultsByEffectRun: new Map<string, EffectRunResult>(),
		issueSeq: 0,
	};
}

function emptyAgentRequestViewsState(): AgentRequestViewsState {
	return {
		requestsById: new Map<string, AgentRequestIssued>(),
		requestsByEffectRun: new Map<string, string[]>(),
		statusByRequest: new Map<string, AgentRequestStatusChanged>(),
		issues: [],
		audit: [],
		auditSeq: 0,
	};
}

function cloneAgentRequestViewsState(state: AgentRequestViewsState): AgentRequestViewsState {
	return {
		requestsById: new Map(state.requestsById),
		requestsByEffectRun: new Map(Array.from(state.requestsByEffectRun, ([k, v]) => [k, [...v]])),
		statusByRequest: new Map(state.statusByRequest),
		issues: [...state.issues],
		audit: [...state.audit],
		auditSeq: state.auditSeq,
	};
}

function reduceAgentRequestViews(state: AgentRequestViewsState, fact: AgentRequestFact): void {
	state.auditSeq += 1;
	if (fact.kind === "issued") {
		state.requestsById.set(fact.requestId, fact);
		const requestIds = state.requestsByEffectRun.get(fact.effectRunId) ?? [];
		if (!requestIds.includes(fact.requestId)) requestIds.push(fact.requestId);
		state.requestsByEffectRun.set(fact.effectRunId, requestIds);
		state.statusByRequest.set(fact.requestId, {
			kind: "status",
			requestId: fact.requestId,
			operationId: fact.operationId,
			effectRunId: fact.effectRunId,
			status: "issued",
			sourceRefs: [ref("agent-request", fact.requestId)],
		});
	} else if (fact.kind === "status") {
		state.statusByRequest.set(fact.requestId, fact);
		if (fact.issues !== undefined) state.issues.push(...fact.issues);
	} else if (fact.kind === "rejected") {
		state.issues.push(fact.issue);
	}
	state.audit.push({
		id: `agent-request-ledger:${state.auditSeq}`,
		kind: `agent-request-${fact.kind}`,
		subjectId: "requestId" in fact ? fact.requestId : fact.proposalId,
	});
}

function freezeAgentRequestViews(state: AgentRequestViewsState): AgentRequestViews {
	const pending = Array.from(state.requestsById.values()).filter((request) => {
		const status = state.statusByRequest.get(request.requestId)?.status;
		return status === undefined || !isTerminalRequestStatus(status);
	});
	const awaitingProvider = pending.filter(
		(request) => state.statusByRequest.get(request.requestId)?.status === "awaiting-provider",
	);
	return {
		requestsById: new Map(state.requestsById),
		requestsByEffectRun: new Map(
			Array.from(state.requestsByEffectRun, ([key, value]) => [key, Object.freeze([...value])]),
		),
		statusByRequest: new Map(state.statusByRequest),
		pending: Object.freeze(pending),
		awaitingProvider: Object.freeze(awaitingProvider),
		issues: Object.freeze([...state.issues]),
		audit: Object.freeze([...state.audit]),
	};
}

function projectRuntimeFact<T, TOut>(
	graph: Graph,
	runtime: Node<T>,
	name: string,
	factory: string,
	pick: (fact: T) => TOut | undefined,
): Node<TOut> {
	return graph.node<TOut>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as T;
				const value = pick(typed);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{ name, factory },
	);
}

function forEachDepBatch(
	ctx: Ctx,
	start: number,
	count: number,
	fn: (value: unknown) => void,
): void {
	for (let i = 0; i < count; i += 1) {
		for (const value of depBatch(ctx, start + i) ?? []) fn(value);
	}
}

function forbiddenDataKeys(
	value: unknown,
	path: readonly (string | number)[] = [],
	seen: WeakSet<object> = new WeakSet(),
): readonly { readonly path: readonly (string | number)[]; readonly reason: string }[] {
	if (typeof value === "function") return [{ path, reason: "function-value" }];
	if (typeof value === "symbol" || typeof value === "bigint") {
		return [{ path, reason: "non-graph-visible-primitive" }];
	}
	if (!isRecord(value) && !Array.isArray(value)) return [];
	if (typeof value === "object" && value !== null) {
		if (seen.has(value)) return [];
		seen.add(value);
	}
	const issues: { readonly path: readonly (string | number)[]; readonly reason: string }[] = [];
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			issues.push(...forbiddenDataKeys(item, [...path, index], seen));
		});
		return issues;
	}
	if (!isPlainRecord(value)) return [{ path, reason: "non-plain-runtime-object" }];
	const symbolKeys = Object.getOwnPropertySymbols(value);
	if (symbolKeys.length > 0) {
		issues.push({ path, reason: "symbol-key" });
	}
	for (const [key, child] of Object.entries(value)) {
		const nextPath = [...path, key];
		if (
			/^(apiKey|api_key|secret|client|transport|subprocess|sdk|oauth|credential|credentials|accessToken|access_token|refreshToken|refresh_token|idToken|id_token|token|password|passphrase|authorization|authHeader|auth_header|bearer|privateKey|private_key|sessionCookie|session_cookie|cookie)$/i.test(
				key,
			)
		) {
			issues.push({ path: nextPath, reason: "forbidden-runtime-key" });
		}
		issues.push(...forbiddenDataKeys(child, nextPath, seen));
	}
	return issues;
}

function forbiddenGraphVisibleMaterialIssues(
	value: unknown,
	subjectRef: SourceRef,
	area: string,
): readonly DataIssue[] {
	if (value === undefined) return [];
	const forbidden = forbiddenDataKeys(value);
	if (forbidden.length === 0) return [];
	return Object.freeze(
		forbidden.map((entry) =>
			dataIssue(
				"tool-provider-catalog-forbidden-runtime-material",
				"Tool provider catalog material must not contain runtime-private adapter material.",
				{ subjectId: subjectRef.id, refs: [subjectRef], details: { area, reason: entry.reason } },
			),
		),
	);
}

function forbiddenAdapterInputMaterialIssues(
	value: unknown,
	subjectRef: SourceRef,
	area: string,
): readonly DataIssue[] {
	if (value === undefined) return [];
	const forbidden = forbiddenDataKeys(value);
	if (forbidden.length === 0) return [];
	return Object.freeze(
		forbidden.map((entry) =>
			dataIssue(
				"tool-provider-adapter-input-forbidden-runtime-material",
				"Tool provider adapter input material must not contain runtime-private adapter material.",
				{ subjectId: subjectRef.id, refs: [subjectRef], details: { area, reason: entry.reason } },
			),
		),
	);
}

function sanitizeAdapterInputSourceRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
	return uniqueSourceRefs(
		sourceRefs.map((sourceRef) => {
			if (sourceRef.metadata === undefined) return sourceRef;
			const metadata = sanitizeGraphVisibleRecord(sourceRef.metadata);
			return metadata === undefined
				? { kind: sourceRef.kind, id: sourceRef.id }
				: { kind: sourceRef.kind, id: sourceRef.id, metadata };
		}),
	);
}

function sanitizeGraphVisibleRecord<T extends Record<string, unknown> | undefined>(
	value: T,
): T | undefined {
	if (value === undefined || forbiddenDataKeys(value).length > 0) return undefined;
	return Object.freeze({ ...value }) as T;
}

function unlockedToolProviderPolicyOverrides(
	overrides:
		| Partial<Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">>
		| undefined,
): Partial<Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">> | undefined {
	if (overrides === undefined) return undefined;
	const rest = { ...(overrides as Record<string, unknown>) };
	delete rest.kind;
	delete rest.policyId;
	delete rest.providerId;
	return rest as Partial<Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">>;
}

function dataIssue(
	code: string,
	message: string,
	opts: {
		readonly subjectId?: string;
		readonly refs?: readonly SourceRef[];
		readonly severity?: DataIssue["severity"];
		readonly details?: unknown;
	} = {},
): DataIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: opts.severity ?? "error",
		subjectId: opts.subjectId,
		refs: opts.refs?.map((r) => `${r.kind}:${r.id}`),
		details: opts.details,
	};
}

function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
