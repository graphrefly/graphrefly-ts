import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { RetentionPolicy } from "../graph/policies/types.js";
import type {
	EffectiveRuntimeRetentionPolicy,
	ReplayEvidenceClassification,
	RuntimeIndexItem,
	RuntimeRetentionIndex,
	RuntimeRetentionIndexConfig,
	RuntimeRetentionPolicyFact,
} from "./agent-runtime-adapter-retention.js";
import {
	adapterInputRetentionEntry,
	buildRetentionPolicyReaders,
	executionRetentionEntry,
	readRetentionPolicyFact,
	retentionEvidenceEntry,
	runIssueRetentionEntry,
	runRequestRetentionEntry,
	runStatusRetentionEntry,
	runtimeDiagnosticKey,
	runtimeEvidenceMetadata,
	runtimeEvidenceSourceRefs,
	runtimeRetentionScorerEntry,
	toolProviderAdapterRuntimeRetentionIndex,
} from "./agent-runtime-adapter-retention.js";
import {
	normalizeToolProviderAdapterBindings,
	toolProviderAdapterRunProjectorInternal,
} from "./agent-runtime-adapter-run.js";
import { runAdapterRuntimeRequest } from "./agent-runtime-adapter-runtime-execute.js";
import {
	publishAdapterRuntimeRetentionEvidenceGlobalFailClosed,
	publishAdapterRuntimeRetentionGap,
} from "./agent-runtime-adapter-runtime-retention-gaps.js";
import {
	createAdapterRuntimeOutputNodes,
	createAdapterRuntimeRetentionIndexes,
} from "./agent-runtime-adapter-runtime-state.js";
import {
	boundPublicText,
	dataIssue,
	isRecord,
	maxPublicMetadataStringChars,
	ref,
	sanitizeAdapterInputIssue,
	sanitizeAdapterInputSourceRefs,
	sanitizeGraphVisibleRecord,
	sanitizeProviderGraphVisibleRecord,
} from "./agent-runtime-common.js";
import {
	adapterRuntimeIssue,
	agentRequestStatusForExecutorOutcome,
	buildToolProviderExecutorOutcome,
	defaultToolProviderAdapterEvidenceRefs,
	outcomeIssues,
} from "./agent-runtime-executor-outcome.js";
import type { AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type {
	AgentRequestStatus,
	AgentRequestStatusChanged,
	ExecutorOutcome,
	SourceRef,
} from "./agent-runtime-types-core.js";
import type {
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunResult,
	ToolProviderAdapterRunStatus,
	ToolProviderAdapterRuntimeHandle,
	ToolProviderAdapterRuntimeOptions,
	ToolProviderAdapterRuntimeRetentionEvidenceEntry,
	ToolProviderAdapterRuntimeRetentionIndex,
	ToolProviderAdapterRuntimeStatus,
} from "./agent-runtime-types-tool.js";

export function attachToolProviderAdapterRuntime<TArguments = unknown, TResult = unknown>(
	graph: Graph,
	opts: ToolProviderAdapterRuntimeOptions<TArguments, TResult>,
): ToolProviderAdapterRuntimeHandle {
	const name = opts.name ?? "toolProviderAdapterRuntime";
	const bindings = normalizeToolProviderAdapterBindings(opts.bindings);
	const retentionReaders = buildRetentionPolicyReaders(graph, name, opts.retention);
	const retentionPolicy = graph.node<RuntimeRetentionPolicyFact>(
		retentionReaders.inputs.deps,
		(ctx) => {
			const current = ctx.state.get<RuntimeRetentionPolicyFact>();
			const fact = readRetentionPolicyFact(ctx, opts.retention, retentionReaders, current);
			ctx.state.set(fact);
			ctx.down([["DATA", fact]]);
		},
		{
			name: `${name}/retentionPolicy`,
			factory: "toolProviderAdapterRuntimeRetentionPolicy",
			partial: true,
		},
	);
	const {
		adapterInputs,
		runRequests,
		executions,
		runStatuses,
		runIssues,
		retentionEvidence,
		closedRetentionEvidence,
	} = createAdapterRuntimeRetentionIndexes<TArguments>();
	const executionHighWaterByInput = new Map<string, number>();
	const trimmedAdapterInputIds = new Set<string>();
	const projectorInputDropById = new Map<string, () => void>();
	let retentionEvidenceHorizonExceeded = false;
	const { outcomes, runStatus, status, runtimeStatus, issues, audit } =
		createAdapterRuntimeOutputNodes(graph, name);
	let disposed = false;
	let auditSeq = 0;
	let retentionSeq = 0;
	let effectiveRetention: EffectiveRuntimeRetentionPolicy = {};

	function nowMs(): number | undefined {
		return opts.now?.();
	}

	function nextRetentionSequence(): number {
		retentionSeq += 1;
		return retentionSeq;
	}

	function publishRuntimeStatus(fact: Omit<ToolProviderAdapterRuntimeStatus, "kind">): void {
		const occurredAtMs = nowMs();
		const { sourceRefs: rawSourceRefs, metadata: rawMetadata, key: rawKey, ...statusFields } = fact;
		const sourceRefs =
			rawSourceRefs === undefined ? undefined : sanitizeAdapterInputSourceRefs(rawSourceRefs);
		const metadata = sanitizeProviderGraphVisibleRecord(rawMetadata, opts.publicText);
		const key =
			rawKey === undefined
				? undefined
				: boundPublicText(
						runtimeDiagnosticKey(rawKey),
						maxPublicMetadataStringChars(opts.publicText),
					).text;
		runtimeStatus.down([
			[
				"DATA",
				{
					kind: "tool-provider-adapter-runtime-status",
					...(occurredAtMs === undefined ? {} : { occurredAtMs }),
					...statusFields,
					...(key === undefined ? {} : { key }),
					...(sourceRefs === undefined ? {} : { sourceRefs }),
					...(metadata === undefined ? {} : { metadata }),
				} satisfies ToolProviderAdapterRuntimeStatus,
			],
		]);
	}

	function publishRuntimeAudit(
		kind: string,
		auditOpts: {
			readonly subjectId?: string;
			readonly sourceRefs?: readonly SourceRef[];
			readonly issueCode?: string;
			readonly metadata?: Record<string, unknown>;
		} = {},
	): void {
		auditSeq += 1;
		const metadata = sanitizeProviderGraphVisibleRecord(auditOpts.metadata, opts.publicText);
		audit.down([
			[
				"DATA",
				{
					id: `${name}:audit:${auditSeq}`,
					kind,
					...(auditOpts.subjectId === undefined ? {} : { subjectId: auditOpts.subjectId }),
					...(auditOpts.sourceRefs === undefined
						? {}
						: { sourceRefs: sanitizeAdapterInputSourceRefs(auditOpts.sourceRefs) }),
					...(auditOpts.issueCode === undefined ? {} : { issueCode: auditOpts.issueCode }),
					...(metadata === undefined ? {} : { metadata }),
				} satisfies AgentRuntimeAuditRecord,
			],
		]);
	}

	function trackRunIssue(issue: DataIssue, emittedKey?: string, dropKey?: () => void): void {
		const sequence = nextRetentionSequence();
		const key = emittedKey ?? `${sequence}:${issue.code}:${issue.subjectId ?? ""}`;
		runIssues.set(key, runIssueRetentionEntry(key, sequence, issue, nowMs()), {
			fact: issue,
			dropKey,
		});
		trimRunIssues();
	}

	function publishIssue(issue: DataIssue, track = true): void {
		issues.down([["DATA", sanitizeAdapterInputIssue(issue)]]);
		if (track) trackRunIssue(issue);
	}

	function publishRunStatus(
		request: ToolProviderAdapterRunRequested,
		nextStatus: ToolProviderAdapterRunStatus["status"],
		statusIssues?: readonly DataIssue[],
		outcomeId?: string,
	): void {
		const statusFact = {
			kind: "tool-provider-adapter-run-status",
			runId: request.runId,
			adapterInputId: request.adapterInputId,
			requestId: request.requestId,
			operationId: request.operationId,
			status: nextStatus,
			attempt: request.attempt,
			outcomeId,
			issues: statusIssues,
			sourceRefs: sanitizeAdapterInputSourceRefs(request.sourceRefs ?? []),
			metadata: sanitizeGraphVisibleRecord(
				{
					providerId: request.providerId,
					routeId: request.routeId,
					reason: request.reason,
				},
				opts.publicText,
			),
		} satisfies ToolProviderAdapterRunStatus;
		runStatus.down([["DATA", statusFact]]);
		trackRunStatus(statusFact);
	}

	function trackRunStatus(
		statusFact: ToolProviderAdapterRunStatus,
		emittedKey?: string,
		dropKey?: () => void,
	): void {
		const sequence = nextRetentionSequence();
		const key = emittedKey ?? `${sequence}:${statusFact.runId}:${statusFact.status}`;
		runStatuses.set(key, runStatusRetentionEntry(key, sequence, statusFact, nowMs()), {
			fact: statusFact,
			dropKey,
		});
		trimRunStatuses();
	}

	function retentionScore<Entry>(
		index: ToolProviderAdapterRuntimeRetentionIndex,
	): ((entry: Entry) => number) | undefined {
		const policy = opts.retention?.[index] as RetentionPolicy<Entry> | undefined;
		return typeof policy?.score === "function" ? policy.score : undefined;
	}

	function trimRuntimeIndex<Entry extends { readonly sequence: number }, Value>(
		indexName: ToolProviderAdapterRuntimeRetentionIndex,
		store: RuntimeRetentionIndex<Entry, Value>,
		config: RuntimeRetentionIndexConfig | undefined,
		onVictim?: (victim: RuntimeIndexItem<Entry, Value>) => void,
	): void {
		if (config?.maxSize === undefined) return;
		let victims: RuntimeIndexItem<Entry, Value>[];
		if (config.mode === "score") {
			const score = retentionScore<Entry>(indexName);
			if (score === undefined) return;
			const selected = store.trimScored(config.maxSize, (entry) => {
				return score(runtimeRetentionScorerEntry(indexName, entry));
			});
			if (selected.invalid !== undefined) {
				publishRetentionScoreInvalid(indexName, selected.invalid);
				return;
			}
			victims = selected.victims ?? [];
		} else {
			victims = store.trimFifo(config.maxSize);
		}
		for (const victim of victims) {
			onVictim?.(victim);
			publishRetentionTrimmed(indexName, victim.key, victim.entry);
		}
	}

	function trackAdapterInputTrimmedEvidence(adapterInputId: string): void {
		trimmedAdapterInputIds.add(adapterInputId);
		const sequence = nextRetentionSequence();
		const key = `adapter-input-trimmed:${adapterInputId}`;
		const entry = retentionEvidenceEntry(key, sequence, {
			adapterInputId,
			evidenceKind: "adapter-input-trimmed",
			occurredAtMs: nowMs(),
			reason: "adapter-input-retention",
		});
		retentionEvidence.set(key, entry, entry);
		trimRetentionEvidence();
	}

	function trackExecutionHighWaterEvidence(adapterInputId: string, attempt: number): void {
		const previous = executionHighWaterByInput.get(adapterInputId) ?? 0;
		const attemptHighWater = Math.max(previous, attempt);
		executionHighWaterByInput.set(adapterInputId, attemptHighWater);
		const sequence = nextRetentionSequence();
		const key = `execution-high-water:${adapterInputId}`;
		const entry = retentionEvidenceEntry(key, sequence, {
			adapterInputId,
			evidenceKind: "execution-high-water",
			occurredAtMs: nowMs(),
			attemptHighWater,
			reason: "execution-proof-retention",
		});
		retentionEvidence.set(key, entry, entry);
		trimRetentionEvidence();
	}

	function retentionEvidenceClosedKey(adapterInputId: string): string {
		return `closed:${adapterInputId}`;
	}

	function isRetentionEvidenceClosed(adapterInputId: string): boolean {
		return (
			retentionEvidenceHorizonExceeded ||
			closedRetentionEvidence.has(retentionEvidenceClosedKey(adapterInputId))
		);
	}

	function classifyRunRequestReplayEvidence(
		request: ToolProviderAdapterRunRequested,
		input?: ToolProviderAdapterInput<TArguments>,
	): ReplayEvidenceClassification {
		if (isRetentionEvidenceClosed(request.adapterInputId)) {
			return {
				kind: "retention-gap",
				index: "retentionEvidence",
				gapKind: "evidence-horizon-closed",
				key: retentionEvidenceClosedKey(request.adapterInputId),
			};
		}
		if (input === undefined && trimmedAdapterInputIds.has(request.adapterInputId)) {
			return {
				kind: "retention-gap",
				index: "adapterInputs",
				gapKind: "adapter-input-trimmed",
				key: `adapter-input-trimmed:${request.adapterInputId}`,
			};
		}
		const highWater = executionHighWaterByInput.get(request.adapterInputId) ?? 0;
		if (highWater >= request.attempt) {
			return {
				kind: "retention-gap",
				index: "executions",
				gapKind: "execution-proof-trimmed",
				key: `execution-high-water:${request.adapterInputId}`,
			};
		}
		if (input === undefined) return { kind: "missing-input" };
		return { kind: "fresh" };
	}

	function classifyRetainedRunRequestReplayEvidence(
		request: ToolProviderAdapterRunRequested,
	): ReplayEvidenceClassification {
		return classifyRunRequestReplayEvidence(request);
	}

	function dropProjectorInput(adapterInputId: string): void {
		projectorInputDropById.get(adapterInputId)?.();
		projectorInputDropById.delete(adapterInputId);
	}

	function closeRetentionEvidenceHorizon(
		victim: RuntimeIndexItem<
			ToolProviderAdapterRuntimeRetentionEvidenceEntry,
			ToolProviderAdapterRuntimeRetentionEvidenceEntry
		>,
	): void {
		const key = retentionEvidenceClosedKey(victim.value.adapterInputId);
		const sequence = nextRetentionSequence();
		const entry = retentionEvidenceEntry(key, sequence, {
			adapterInputId: victim.value.adapterInputId,
			evidenceKind: victim.value.evidenceKind,
			occurredAtMs: nowMs(),
			...(victim.value.attemptHighWater === undefined
				? {}
				: { attemptHighWater: victim.value.attemptHighWater }),
			reason: victim.value.reason,
		});
		closedRetentionEvidence.set(key, entry, entry);
		trimClosedRetentionEvidence();
	}

	function trimClosedRetentionEvidence(): void {
		const maxSize = effectiveRetention.retentionEvidence?.maxSize;
		if (maxSize === undefined) return;
		const victims = closedRetentionEvidence.trimFifo(maxSize);
		for (const victim of victims) {
			const firstGlobalClosure = !retentionEvidenceHorizonExceeded;
			if (firstGlobalClosure) retentionEvidenceHorizonExceeded = true;
			publishRetentionTrimmed("retentionEvidence", victim.key, victim.entry);
			if (firstGlobalClosure) {
				publishRetentionEvidenceGlobalFailClosed(victim);
			}
		}
	}

	function trimAdapterInputs(): void {
		trimRuntimeIndex("adapterInputs", adapterInputs, effectiveRetention.adapterInputs, (victim) => {
			dropProjectorInput(victim.value.adapterInputId);
			trackAdapterInputTrimmedEvidence(victim.value.adapterInputId);
		});
	}

	function trimRunRequests(): void {
		trimRuntimeIndex("runRequests", runRequests, effectiveRetention.runRequests, (victim) => {
			victim.value.dropKey?.();
		});
	}

	function trimExecutions(): void {
		trimRuntimeIndex("executions", executions, effectiveRetention.executions, (victim) => {
			trackExecutionHighWaterEvidence(victim.value.adapterInputId, victim.value.attempt);
		});
	}

	function trimRunStatuses(): void {
		trimRuntimeIndex("runStatuses", runStatuses, effectiveRetention.runStatuses, (victim) => {
			victim.value.dropKey?.();
		});
	}

	function trimRunIssues(): void {
		trimRuntimeIndex("runIssues", runIssues, effectiveRetention.runIssues, (victim) => {
			victim.value.dropKey?.();
		});
	}

	function trimRetentionEvidence(): void {
		trimRuntimeIndex(
			"retentionEvidence",
			retentionEvidence,
			effectiveRetention.retentionEvidence,
			(victim) => {
				closeRetentionEvidenceHorizon(victim);
				if (victim.value.evidenceKind === "adapter-input-trimmed") {
					trimmedAdapterInputIds.delete(victim.value.adapterInputId);
				} else {
					executionHighWaterByInput.delete(victim.value.adapterInputId);
				}
				adapterInputs.delete(victim.value.adapterInputId);
				dropProjectorInput(victim.value.adapterInputId);
			},
		);
	}

	function trimAllRetentionIndexes(): void {
		trimAdapterInputs();
		trimRunRequests();
		trimExecutions();
		trimRunStatuses();
		trimRunIssues();
		trimRetentionEvidence();
	}

	function publishRetentionTrimmed(
		index: ToolProviderAdapterRuntimeRetentionIndex,
		key: string,
		entry: unknown,
	): void {
		const record = isRecord(entry) ? entry : {};
		const evidenceKind = typeof record.evidenceKind === "string" ? record.evidenceKind : undefined;
		const code =
			index === "retentionEvidence"
				? "tool-provider-adapter-runtime-retention-evidence-trimmed"
				: "tool-provider-adapter-runtime-retention-trimmed";
		const issue = dataIssue(
			code,
			index === "retentionEvidence"
				? "Tool provider adapter runtime retention trimmed replay proof evidence and closed the affected horizon."
				: "Tool provider adapter runtime retention trimmed a runtime-private index entry.",
			{
				subjectId:
					typeof record.adapterInputId === "string"
						? record.adapterInputId
						: typeof record.key === "string"
							? runtimeDiagnosticKey(record.key)
							: index,
				refs: runtimeEvidenceSourceRefs(index),
				details: runtimeEvidenceMetadata(index, { key }),
				severity: "info",
			},
		);
		publishIssue(issue, false);
		const sourceRefs = runtimeEvidenceSourceRefs(index);
		const metadata = runtimeEvidenceMetadata(index, {
			key,
			extra: evidenceKind === undefined ? {} : { evidenceKind },
		});
		publishRuntimeStatus({
			status: "retention-trimmed",
			index,
			key,
			...(typeof record.adapterInputId === "string"
				? { adapterInputId: record.adapterInputId }
				: {}),
			...(typeof record.runId === "string" ? { runId: record.runId } : {}),
			...(typeof record.attempt === "number" ? { attempt: record.attempt } : {}),
			issueCode: issue.code,
			sourceRefs,
			metadata,
		});
		publishRuntimeAudit("tool-provider-adapter-runtime-retention-trimmed", {
			subjectId: issue.subjectId,
			sourceRefs,
			issueCode: issue.code,
			metadata,
		});
	}

	function publishRetentionScoreInvalid(
		index: ToolProviderAdapterRuntimeRetentionIndex,
		reason: "threw" | "non-finite",
	): void {
		const issue = dataIssue(
			"tool-provider-adapter-retention-score-invalid",
			"Tool provider adapter runtime retention scorer returned invalid material; last-known-good policy remains active.",
			{
				subjectId: index,
				refs: runtimeEvidenceSourceRefs(index),
				details: runtimeEvidenceMetadata(index, { extra: { reason } }),
				severity: "warning",
			},
		);
		publishIssue(issue, index !== "runIssues");
		const sourceRefs = runtimeEvidenceSourceRefs(index);
		const metadata = runtimeEvidenceMetadata(index, { extra: { reason } });
		publishRuntimeStatus({
			status: "invalid-retention-policy",
			index,
			issueCode: issue.code,
			sourceRefs,
			metadata,
		});
		publishRuntimeAudit("tool-provider-adapter-runtime-invalid-retention-policy", {
			subjectId: index,
			sourceRefs,
			issueCode: issue.code,
			metadata,
		});
	}

	function applyRetentionPolicyFact(fact: RuntimeRetentionPolicyFact): void {
		const invalidIndexes = new Set<ToolProviderAdapterRuntimeRetentionIndex>();
		if (fact.issues !== undefined && fact.issues.length > 0) {
			for (const issue of fact.issues) {
				publishIssue(issue);
				const index = toolProviderAdapterRuntimeRetentionIndex(issue.subjectId);
				if (index !== undefined) invalidIndexes.add(index);
				publishRuntimeStatus({
					status: "invalid-retention-policy",
					...(index === undefined ? {} : { index }),
					issueCode: issue.code,
					...(index === undefined ? {} : { sourceRefs: runtimeEvidenceSourceRefs(index) }),
				});
				publishRuntimeAudit("tool-provider-adapter-runtime-invalid-retention-policy", {
					...(issue.subjectId === undefined ? {} : { subjectId: issue.subjectId }),
					...(index === undefined ? {} : { sourceRefs: runtimeEvidenceSourceRefs(index) }),
					issueCode: issue.code,
				});
			}
		}
		const adapterInputsPolicy = fact.policies.get("adapterInputs");
		const runRequestsPolicy = fact.policies.get("runRequests");
		const executionsPolicy = fact.policies.get("executions");
		const runStatusesPolicy = fact.policies.get("runStatuses");
		const runIssuesPolicy = fact.policies.get("runIssues");
		const retentionEvidencePolicy = fact.policies.get("retentionEvidence");
		effectiveRetention = {
			...(invalidIndexes.has("adapterInputs")
				? effectiveRetention.adapterInputs === undefined
					? {}
					: { adapterInputs: effectiveRetention.adapterInputs }
				: adapterInputsPolicy === undefined
					? {}
					: { adapterInputs: adapterInputsPolicy }),
			...(invalidIndexes.has("runRequests")
				? effectiveRetention.runRequests === undefined
					? {}
					: { runRequests: effectiveRetention.runRequests }
				: runRequestsPolicy === undefined
					? {}
					: { runRequests: runRequestsPolicy }),
			...(invalidIndexes.has("executions")
				? effectiveRetention.executions === undefined
					? {}
					: { executions: effectiveRetention.executions }
				: executionsPolicy === undefined
					? {}
					: { executions: executionsPolicy }),
			...(invalidIndexes.has("runStatuses")
				? effectiveRetention.runStatuses === undefined
					? {}
					: { runStatuses: effectiveRetention.runStatuses }
				: runStatusesPolicy === undefined
					? {}
					: { runStatuses: runStatusesPolicy }),
			...(invalidIndexes.has("runIssues")
				? effectiveRetention.runIssues === undefined
					? {}
					: { runIssues: effectiveRetention.runIssues }
				: runIssuesPolicy === undefined
					? {}
					: { runIssues: runIssuesPolicy }),
			...(invalidIndexes.has("retentionEvidence")
				? effectiveRetention.retentionEvidence === undefined
					? {}
					: { retentionEvidence: effectiveRetention.retentionEvidence }
				: retentionEvidencePolicy === undefined
					? {}
					: { retentionEvidence: retentionEvidencePolicy }),
		};
		trimAllRetentionIndexes();
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
		request: ToolProviderAdapterRunRequested,
	): void {
		if (disposed) return;
		let outcome: ExecutorOutcome<TResult>;
		try {
			outcome = buildToolProviderExecutorOutcome(input, result, {
				attempt: request.attempt,
				runId: request.runId,
				occurredAtMs: opts.now?.(),
				publicText: opts.publicText,
			});
		} catch (error) {
			const issue = adapterRuntimeIssue(
				input,
				"tool-provider-adapter-runtime-invalid-input",
				error,
			);
			publishIssue(issue);
			publishRunStatus(request, "failure", [issue]);
			publishStatus(input, "failed", [issue]);
			publishAudit(input, "tool-provider-adapter-runtime-invalid-input", undefined, issue.code);
			return;
		}
		outcomes.down([["DATA", outcome]]);
		const execution = executions.get(executionCoordinate(request));
		if (execution !== undefined) {
			executions.set(
				execution.key,
				executionRetentionEntry(
					execution.key,
					execution.entry.sequence,
					request,
					outcome.kind,
					outcome.occurredAtMs,
					outcome.outcomeId,
				),
				request,
			);
		}
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
		publishRunStatus(
			request,
			outcome.kind,
			statusIssues.length === 0 ? undefined : statusIssues,
			outcome.outcomeId,
		);
		publishAudit(input, "tool-provider-adapter-runtime-finished", {
			status: outcome.kind,
			outcomeId: outcome.outcomeId,
			runId: request.runId,
			attempt: request.attempt,
		});
	}

	function publishRuntimeFailure(
		input: ToolProviderAdapterInput<TArguments>,
		request: ToolProviderAdapterRunRequested,
		code: string,
		error: unknown,
	): void {
		const issue = adapterRuntimeIssue(input, code, error);
		publishOutcome(
			input,
			{
				kind: "failure",
				error: issue,
				retryable: false,
				issues: [issue],
			},
			request,
		);
	}

	function executionCoordinate(request: ToolProviderAdapterRunRequested): string {
		return `${request.adapterInputId}:${request.attempt}`;
	}

	function trackRunRequest(
		request: ToolProviderAdapterRunRequested,
		emittedKey: string,
		dropKey: () => void,
	): void {
		const sequence = nextRetentionSequence();
		runRequests.set(emittedKey, runRequestRetentionEntry(emittedKey, sequence, request), {
			fact: request,
			dropKey,
		});
		trimRunRequests();
	}

	function startExecutionProof(request: ToolProviderAdapterRunRequested): boolean {
		const coordinate = executionCoordinate(request);
		const existing = executions.get(coordinate);
		if (existing !== undefined) {
			if (existing.value.runId !== request.runId) {
				const issue = dataIssue(
					"tool-provider-adapter-runtime-duplicate-execution-coordinate",
					"Tool provider adapter runtime requires one visible runId per adapterInputId and attempt.",
					{
						subjectId: request.adapterInputId,
						refs: [ref("tool-provider-adapter-run", request.runId)],
						details: {
							adapterInputId: request.adapterInputId,
							attempt: request.attempt,
						},
					},
				);
				publishIssue(issue);
				publishRunStatus(request, "mismatched-request", [issue]);
				publishRuntimeAudit("tool-provider-adapter-runtime-duplicate-execution-coordinate", {
					subjectId: request.adapterInputId,
					sourceRefs: [ref("tool-provider-adapter-run", request.runId)],
					issueCode: issue.code,
					metadata: {
						adapterInputId: request.adapterInputId,
						attempt: request.attempt,
						key: runtimeDiagnosticKey(coordinate),
					},
				});
			}
			return false;
		}
		const sequence = nextRetentionSequence();
		executions.set(
			coordinate,
			executionRetentionEntry(coordinate, sequence, request, "started", nowMs()),
			request,
		);
		trimExecutions();
		const classification = classifyRunRequestReplayEvidence(
			request,
			adapterInputs.get(request.adapterInputId)?.value,
		);
		if (classification.kind !== "fresh") {
			executions.delete(coordinate);
			publishReplayClassification(request, classification);
			return false;
		}
		return true;
	}

	function publishReplayClassification(
		request: ToolProviderAdapterRunRequested,
		classification: ReplayEvidenceClassification,
	): boolean {
		if (classification.kind === "fresh") return false;
		if (classification.kind === "missing-input") {
			const issueCode = "tool-provider-adapter-runtime-missing-input";
			const issue = dataIssue(
				issueCode,
				"Tool provider adapter runtime requires the requested adapter input.",
				{
					subjectId: request.adapterInputId,
					refs: [ref("tool-provider-adapter-run", request.runId)],
					details: {
						adapterInputId: request.adapterInputId,
						runId: request.runId,
						attempt: request.attempt,
						issueCode,
					},
				},
			);
			publishIssue(issue);
			publishRunStatus(request, "missing-input", [issue]);
			return true;
		}
		publishRetentionGap(request, classification);
		return true;
	}

	function publishRetentionGap(
		request: ToolProviderAdapterRunRequested,
		classification: Extract<ReplayEvidenceClassification, { readonly kind: "retention-gap" }>,
	): void {
		publishAdapterRuntimeRetentionGap(
			{ publishIssue, publishRunStatus, publishRuntimeStatus, publishRuntimeAudit },
			request,
			classification,
		);
	}

	function publishRetentionEvidenceGlobalFailClosed(
		victim: RuntimeIndexItem<
			ToolProviderAdapterRuntimeRetentionEvidenceEntry,
			ToolProviderAdapterRuntimeRetentionEvidenceEntry
		>,
	): void {
		publishAdapterRuntimeRetentionEvidenceGlobalFailClosed(
			{ publishIssue, publishRunStatus, publishRuntimeStatus, publishRuntimeAudit },
			victim,
		);
	}

	function runRequest(request: ToolProviderAdapterRunRequested): void {
		runAdapterRuntimeRequest(
			{
				isDisposed: () => disposed,
				adapterInputs,
				executions,
				bindings,
				now: opts.now,
				classifyRunRequestReplayEvidence,
				publishReplayClassification,
				startExecutionProof,
				executionCoordinate,
				publishIssue,
				publishRunStatus,
				publishStatus,
				publishAudit,
				publishOutcome,
				publishRuntimeFailure,
			},
			request,
		);
	}

	const unsubscribeRetentionPolicy = retentionPolicy.subscribe((msg) => {
		if (msg[0] === "DATA") applyRetentionPolicyFact(msg[1] as RuntimeRetentionPolicyFact);
	});
	const unsubscribeInputs = opts.inputs.subscribe((msg) => {
		if (msg[0] !== "DATA") return;
		const input = msg[1] as ToolProviderAdapterInput<TArguments>;
		if (isRetentionEvidenceClosed(input.adapterInputId)) {
			adapterInputs.delete(input.adapterInputId);
			dropProjectorInput(input.adapterInputId);
			return;
		}
		if (trimmedAdapterInputIds.delete(input.adapterInputId)) {
			retentionEvidence.delete(`adapter-input-trimmed:${input.adapterInputId}`);
		}
		const sequence = nextRetentionSequence();
		adapterInputs.set(
			input.adapterInputId,
			adapterInputRetentionEntry(input.adapterInputId, sequence, input, nowMs()),
			input,
		);
		trimAdapterInputs();
	});
	const runProjector = toolProviderAdapterRunProjectorInternal(graph, {
		name: `${name}/runs`,
		inputs: opts.inputs,
		runRequests: opts.runRequests,
		autoRunReadyInputs: opts.autoRunReadyInputs,
		now: opts.now,
		publicText: opts.publicText,
		privateRetentionHooks: {
			onRunRequestKey(entry) {
				trackRunRequest(entry.request, entry.key, entry.dropKey);
			},
			onRunStatusKey(entry) {
				trackRunStatus(entry.status, entry.key, entry.dropKey);
			},
			onRunIssueKey(entry) {
				trackRunIssue(entry.issue, entry.key, entry.dropKey);
			},
			onAdapterInputKey(entry) {
				if (
					isRetentionEvidenceClosed(entry.adapterInputId) ||
					!adapterInputs.has(entry.adapterInputId)
				) {
					entry.dropInput();
					projectorInputDropById.delete(entry.adapterInputId);
					return;
				}
				projectorInputDropById.set(entry.adapterInputId, entry.dropInput);
			},
			classifyRetainedRunRequestReplayEvidence,
		},
	});
	const unsubscribeRunProjectorStatus = runProjector.status.subscribe((msg) => {
		if (msg[0] === "DATA") {
			const statusFact = msg[1] as ToolProviderAdapterRunStatus;
			runStatus.down([["DATA", statusFact]]);
		}
	});
	const unsubscribeRunProjectorIssues = runProjector.issues.subscribe((msg) => {
		if (msg[0] === "DATA") publishIssue(msg[1] as DataIssue, false);
	});
	const unsubscribeRunProjectorAudit = runProjector.audit.subscribe((msg) => {
		if (msg[0] === "DATA") audit.down([["DATA", msg[1] as AgentRuntimeAuditRecord]]);
	});
	const unsubscribeRunRequests = runProjector.requests.subscribe((msg) => {
		if (msg[0] !== "DATA") return;
		const request = msg[1] as ToolProviderAdapterRunRequested;
		runRequest(request);
	});

	return {
		runRequests: runProjector.requests,
		runStatus,
		runtimeStatus,
		outcomes,
		status,
		issues,
		audit,
		dispose() {
			if (disposed) return;
			disposed = true;
			unsubscribeRetentionPolicy();
			unsubscribeInputs();
			unsubscribeRunProjectorStatus();
			unsubscribeRunProjectorIssues();
			unsubscribeRunProjectorAudit();
			unsubscribeRunRequests();
		},
	};
}
