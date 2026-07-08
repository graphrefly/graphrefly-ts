import type { DataIssue } from "../../data/index.js";
import {
	AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND,
	type AgenticMemoryCommittedFactBatch,
	type AgenticMemoryCommittedFactCursor,
	type AgenticMemoryCommittedFactLog,
	type AgenticMemoryCommittedFactReadOptions,
	type AgenticMemoryCommittedFactReadResult,
	type AgenticMemoryFactCommitResult,
	type AgenticMemoryFactLogAuditEntry,
	assertAgenticMemoryCommittedFactBatch,
} from "./committed-fact-log.js";
import {
	normalizeAgenticMemoryCommittedFactLogBackendAppendResult,
	normalizeAgenticMemoryCommittedFactLogBackendReadResult,
} from "./committed-fact-log-backend.js";
import {
	type AgenticMemoryDurabilityDownstreamAdvancePolicy,
	type AgenticMemoryDurabilityGateInput,
	type AgenticMemoryDurabilityGateProjection,
	type AgenticMemoryDurabilityGateStatus,
	agenticMemoryDurabilityGateInput,
	projectAgenticMemoryDurabilityGate,
} from "./durable-result.js";
import {
	type AgenticMemoryMaterializedFactLogBootstrapInput,
	type AgenticMemoryMaterializedFactLogBootstrapProjection,
	type AgenticMemoryMaterializedFactLogBootstrapStatus,
	projectAgenticMemoryMaterializedFactLogBootstrap,
} from "./fact-log-bootstrap.js";
import {
	type AgenticMemoryCommittedFactReadMaterializationProjection,
	projectAgenticMemoryCommittedFactReadMaterialization,
} from "./fact-log-read-materialization.js";
import type {
	AgenticMemoryRecord,
	AgenticMemoryRecordApplicationEvidence,
	AgenticMemoryRecordApplicationPriorEvidence,
	StrictJsonValue,
} from "./types.js";

export interface AgenticMemoryCommittedFactLogStartupReadOptions {
	readonly read?: AgenticMemoryCommittedFactReadOptions;
	readonly evaluation?: number;
}

export interface AgenticMemoryCommittedFactLogStartupReadCursor {
	readonly evaluation: number;
	readonly factLogCursor: AgenticMemoryCommittedFactCursor;
	readonly readMaterialization: AgenticMemoryCommittedFactReadMaterializationProjection["cursor"];
	readonly bootstrap: AgenticMemoryMaterializedFactLogBootstrapProjection["cursor"];
}

export interface AgenticMemoryCommittedFactLogAppendAttemptOptions {
	readonly evaluation?: number;
	readonly downstreamAdvancePolicy?: AgenticMemoryDurabilityDownstreamAdvancePolicy;
}

export interface AgenticMemoryCommittedFactLogAppendAttemptCursor {
	readonly evaluation: number;
	readonly factLogCursor: AgenticMemoryCommittedFactCursor;
	readonly durability: AgenticMemoryDurabilityGateProjection["cursor"];
}

export interface AgenticMemoryCommittedFactLogRuntimePersistenceAuditEntry {
	readonly kind: "agentic-memory-committed-fact-log-runtime-persistence-audit";
	readonly action:
		| "startup-read-attempted"
		| "startup-read-projected"
		| "append-attempted"
		| "append-durability-projected"
		| "read-result-linked"
		| "commit-result-linked"
		| "materialization-linked"
		| "bootstrap-linked"
		| "durability-linked"
		| "issue-recorded";
	readonly reason?: string;
	readonly factLogCursor?: AgenticMemoryCommittedFactCursor;
}

export interface AgenticMemoryCommittedFactLogStartupReadResult<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly kind: "agentic-memory-committed-fact-log-startup-read-result";
	readonly readResult: AgenticMemoryCommittedFactReadResult<TJson>;
	readonly materialization: AgenticMemoryCommittedFactReadMaterializationProjection<TJson>;
	readonly bootstrap: AgenticMemoryMaterializedFactLogBootstrapProjection<TJson>;
	readonly bootstrapInput: AgenticMemoryMaterializedFactLogBootstrapInput<TJson>;
	readonly records: readonly AgenticMemoryRecord<TJson>[];
	readonly priorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
	readonly evidence: readonly AgenticMemoryRecordApplicationEvidence[];
	readonly bootstrapStatus: AgenticMemoryMaterializedFactLogBootstrapStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryCommittedFactLogRuntimePersistenceAuditEntry[];
	readonly cursor: AgenticMemoryCommittedFactLogStartupReadCursor;
}

export interface AgenticMemoryCommittedFactLogAppendAttemptResult<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly kind: "agentic-memory-committed-fact-log-append-attempt-result";
	readonly batch: AgenticMemoryCommittedFactBatch<TJson>;
	readonly commitResult: AgenticMemoryFactCommitResult;
	readonly attemptResult: AgenticMemoryDurabilityGateInput<TJson>;
	readonly durability: AgenticMemoryDurabilityGateProjection;
	readonly durabilityStatus: AgenticMemoryDurabilityGateStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryCommittedFactLogRuntimePersistenceAuditEntry[];
	readonly cursor: AgenticMemoryCommittedFactLogAppendAttemptCursor;
}

/** Read committed facts at runtime start and project D591/D593 DATA.
 *
 * This helper is an explicit runtime/source-boundary composition over D589,
 * D591, and D593. It calls the supplied fact log's `read` method, materializes
 * the returned committed facts with library-owned rules, and exposes
 * caller-wirable records, priorEvidence, evidence, status, issues, audit, and
 * cursor DTOs. It does not read a concrete backend directly, hydrate/restore a
 * graph, mutate live records, refresh subscribers, or create a graph commit
 * barrier.
 *
 * @param log - D589/D592-compatible committed fact log.
 * @param opts - Optional read cursor/limit and evaluation counter.
 * @returns Startup read composition DATA, or a PromiseLike when the log is async.
 * @category solutions
 */
export function agenticMemoryCommittedFactLogStartupRead<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	log: AgenticMemoryCommittedFactLog<TJson>,
	opts: AgenticMemoryCommittedFactLogStartupReadOptions = {},
):
	| AgenticMemoryCommittedFactLogStartupReadResult<TJson>
	| PromiseLike<AgenticMemoryCommittedFactLogStartupReadResult<TJson>> {
	const evaluation = opts.evaluation ?? 0;
	const fallbackCursor = freezeFactCursor(opts.read?.after ?? factCursor(0));
	try {
		const read = log.read(opts.read);
		return isPromiseLike(read)
			? read.then(
					(result) =>
						safeStartupReadResult<TJson>(
							normalizeAgenticMemoryCommittedFactLogBackendReadResult<TJson>(result, {
								fallbackCursor,
							}),
							evaluation,
							fallbackCursor,
						),
					(error) => startupReadResult<TJson>(readFailureResult(error, fallbackCursor), evaluation),
				)
			: startupReadResult<TJson>(
					normalizeAgenticMemoryCommittedFactLogBackendReadResult<TJson>(read, {
						fallbackCursor,
					}),
					evaluation,
				);
	} catch (error) {
		return startupReadResult<TJson>(readFailureResult(error, fallbackCursor), evaluation);
	}
}

/** Append a canonical committed fact batch and project D590 durability DATA.
 *
 * This helper is an explicit runtime/source-boundary composition over D589 and
 * D590. It appends only caller-supplied canonical committed fact batches through
 * the supplied fact log and returns durability DATA for explicit downstream
 * policy. A result is fact-log persistence progress only: not application
 * acknowledgement, live graph truth, record mutation authority, hot hydration,
 * restore, or a graph wave/batch commit barrier.
 *
 * @param log - D589/D592-compatible committed fact log.
 * @param batch - Canonical committed fact batch to append.
 * @param opts - Optional evaluation counter and explicit downstream policy.
 * @returns Append attempt composition DATA, or a PromiseLike when the log is async.
 * @category solutions
 */
export function agenticMemoryCommittedFactLogAppendAttempt<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	log: AgenticMemoryCommittedFactLog<TJson>,
	batch: AgenticMemoryCommittedFactBatch<TJson>,
	opts: AgenticMemoryCommittedFactLogAppendAttemptOptions = {},
):
	| AgenticMemoryCommittedFactLogAppendAttemptResult<TJson>
	| PromiseLike<AgenticMemoryCommittedFactLogAppendAttemptResult<TJson>> {
	const canonicalBatch = assertAgenticMemoryCommittedFactBatch<TJson>(batch);
	const evaluation = opts.evaluation ?? 0;
	try {
		const appended = log.append(canonicalBatch);
		return isPromiseLike(appended)
			? appended.then(
					(result) =>
						safeAppendAttemptResult(
							canonicalBatch,
							normalizeAgenticMemoryCommittedFactLogBackendAppendResult(result, {
								expectedFacts: canonicalBatch.facts.length,
							}),
							opts,
							evaluation,
						),
					(error) =>
						appendAttemptResult(
							canonicalBatch,
							appendFailureResult(error, factCursor(0)),
							opts,
							evaluation,
						),
				)
			: appendAttemptResult(
					canonicalBatch,
					normalizeAgenticMemoryCommittedFactLogBackendAppendResult(appended, {
						expectedFacts: canonicalBatch.facts.length,
					}),
					opts,
					evaluation,
				);
	} catch (error) {
		return appendAttemptResult(
			canonicalBatch,
			appendFailureResult(error, factCursor(0)),
			opts,
			evaluation,
		);
	}
}

function safeStartupReadResult<TJson extends StrictJsonValue>(
	readResult: AgenticMemoryCommittedFactReadResult<TJson>,
	evaluation: number,
	fallbackCursor: AgenticMemoryCommittedFactCursor,
): AgenticMemoryCommittedFactLogStartupReadResult<TJson> {
	try {
		return startupReadResult<TJson>(readResult, evaluation);
	} catch (error) {
		return startupReadResult<TJson>(readFailureResult(error, fallbackCursor), evaluation);
	}
}

function safeAppendAttemptResult<TJson extends StrictJsonValue>(
	batch: AgenticMemoryCommittedFactBatch<TJson>,
	commitResult: AgenticMemoryFactCommitResult,
	opts: AgenticMemoryCommittedFactLogAppendAttemptOptions,
	evaluation: number,
): AgenticMemoryCommittedFactLogAppendAttemptResult<TJson> {
	try {
		return appendAttemptResult(batch, commitResult, opts, evaluation);
	} catch (error) {
		return appendAttemptResult(batch, appendFailureResult(error, factCursor(0)), opts, evaluation);
	}
}

function startupReadResult<TJson extends StrictJsonValue>(
	readResult: AgenticMemoryCommittedFactReadResult<TJson>,
	evaluation: number,
): AgenticMemoryCommittedFactLogStartupReadResult<TJson> {
	const materialization = projectAgenticMemoryCommittedFactReadMaterialization<TJson>(readResult, {
		evaluation,
	});
	const bootstrap = projectAgenticMemoryMaterializedFactLogBootstrap<TJson>(materialization, {
		evaluation,
	});
	const cursor: AgenticMemoryCommittedFactLogStartupReadCursor = Object.freeze({
		evaluation,
		factLogCursor: freezeFactCursor(bootstrap.status.factLogCursor),
		readMaterialization: materialization.cursor,
		bootstrap: bootstrap.cursor,
	});
	const issues = Object.freeze([...bootstrap.issues]);
	return Object.freeze({
		kind: "agentic-memory-committed-fact-log-startup-read-result",
		readResult,
		materialization,
		bootstrap,
		bootstrapInput: bootstrap.input,
		records: bootstrap.records,
		priorEvidence: bootstrap.priorEvidence,
		evidence: bootstrap.evidence,
		bootstrapStatus: bootstrap.status,
		issues,
		audit: Object.freeze([
			auditEntry("startup-read-attempted", {
				factLogCursor: readResult.cursor,
				reason: "explicit runtime boundary read",
			}),
			auditEntry("read-result-linked", {
				factLogCursor: readResult.cursor,
				reason: `${readResult.facts.length} committed facts supplied as DATA`,
			}),
			auditEntry("materialization-linked", {
				factLogCursor: materialization.status.factLogCursor,
				reason: materialization.status.state,
			}),
			auditEntry("bootstrap-linked", {
				factLogCursor: bootstrap.status.factLogCursor,
				reason: bootstrap.status.readyForCallerWiring
					? "caller-wirable DATA ready"
					: "caller-wirable DATA not ready",
			}),
			auditEntry("startup-read-projected", {
				factLogCursor: bootstrap.status.factLogCursor,
				reason: "D591 materialization and D593 bootstrap projection completed",
			}),
			...issues.map((item) => auditEntry("issue-recorded", { reason: item.code })),
		]),
		cursor,
	});
}

function appendAttemptResult<TJson extends StrictJsonValue>(
	batch: AgenticMemoryCommittedFactBatch<TJson>,
	commitResult: AgenticMemoryFactCommitResult,
	opts: AgenticMemoryCommittedFactLogAppendAttemptOptions,
	evaluation: number,
): AgenticMemoryCommittedFactLogAppendAttemptResult<TJson> {
	const attemptResult = agenticMemoryDurabilityGateInput(batch, commitResult);
	const durability = projectAgenticMemoryDurabilityGate(batch, commitResult, {
		evaluation,
		downstreamAdvancePolicy: opts.downstreamAdvancePolicy,
	});
	const cursor: AgenticMemoryCommittedFactLogAppendAttemptCursor = Object.freeze({
		evaluation,
		factLogCursor: freezeFactCursor(durability.status.factLogCursor),
		durability: durability.cursor,
	});
	const issues = Object.freeze([...durability.issues]);
	return Object.freeze({
		kind: "agentic-memory-committed-fact-log-append-attempt-result",
		batch,
		commitResult,
		attemptResult,
		durability,
		durabilityStatus: durability.status,
		issues,
		audit: Object.freeze([
			auditEntry("append-attempted", {
				factLogCursor: commitResult.cursor,
				reason: "explicit runtime boundary append",
			}),
			auditEntry("commit-result-linked", {
				factLogCursor: commitResult.cursor,
				reason: commitResult.status,
			}),
			auditEntry("durability-linked", {
				factLogCursor: durability.status.factLogCursor,
				reason: durability.status.state,
			}),
			auditEntry("append-durability-projected", {
				factLogCursor: durability.status.factLogCursor,
				reason: "D590 durability result DATA projected",
			}),
			...issues.map((item) => auditEntry("issue-recorded", { reason: item.code })),
		]),
		cursor,
	});
}

function readFailureResult<TJson extends StrictJsonValue>(
	error: unknown,
	cursor: AgenticMemoryCommittedFactCursor,
): AgenticMemoryCommittedFactReadResult<TJson> {
	const readIssue = issue(
		"agentic-memory.fact-log-runtime.startup-read-threw",
		error instanceof Error ? error.message : String(error),
	);
	return Object.freeze({
		facts: Object.freeze([]),
		cursor: freezeFactCursor(cursor),
		done: false,
		issues: Object.freeze([readIssue]),
		audit: Object.freeze([
			factLogAudit("facts-read", {
				cursor,
				reason: "runtime boundary read failed before committed facts were proven",
			}),
			factLogAudit("issue-recorded", { reason: readIssue.code }),
		]),
	});
}

function appendFailureResult(
	error: unknown,
	cursor: AgenticMemoryCommittedFactCursor,
): AgenticMemoryFactCommitResult {
	const appendIssue = issue(
		"agentic-memory.fact-log-runtime.append-threw",
		error instanceof Error ? error.message : String(error),
	);
	return Object.freeze({
		status: "uncertain",
		cursor: freezeFactCursor(cursor),
		facts: 0,
		issues: Object.freeze([appendIssue]),
		audit: Object.freeze([
			factLogAudit("batch-uncertain", {
				cursor,
				reason: "runtime boundary append failed before commit status was proven",
			}),
			factLogAudit("issue-recorded", { reason: appendIssue.code }),
		]),
	});
}

function factCursor(position: number): AgenticMemoryCommittedFactCursor {
	return Object.freeze({ kind: AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND, position });
}

function freezeFactCursor(
	cursor: AgenticMemoryCommittedFactCursor,
): AgenticMemoryCommittedFactCursor {
	if (cursor.kind !== AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND) {
		throw new TypeError("AgenticMemory fact-log runtime cursor must be a fact-stream cursor");
	}
	if (!Number.isSafeInteger(cursor.position) || cursor.position < 0) {
		throw new TypeError("AgenticMemory fact-log runtime cursor position must be >= 0");
	}
	return Object.freeze({ kind: cursor.kind, position: cursor.position });
}

function issue(code: string, message: string): DataIssue {
	return Object.freeze({ kind: "issue", code, message, severity: "error" });
}

function factLogAudit(
	action: AgenticMemoryFactLogAuditEntry["action"],
	fields: Omit<AgenticMemoryFactLogAuditEntry, "kind" | "action"> = {},
): AgenticMemoryFactLogAuditEntry {
	return Object.freeze({ kind: "agentic-memory-fact-log-audit", action, ...fields });
}

function auditEntry(
	action: AgenticMemoryCommittedFactLogRuntimePersistenceAuditEntry["action"],
	fields: Omit<AgenticMemoryCommittedFactLogRuntimePersistenceAuditEntry, "kind" | "action"> = {},
): AgenticMemoryCommittedFactLogRuntimePersistenceAuditEntry {
	return Object.freeze({
		kind: "agentic-memory-committed-fact-log-runtime-persistence-audit",
		action,
		...fields,
	});
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
	return (
		value !== null &&
		(typeof value === "object" || typeof value === "function") &&
		typeof (value as PromiseLike<T>).then === "function"
	);
}
