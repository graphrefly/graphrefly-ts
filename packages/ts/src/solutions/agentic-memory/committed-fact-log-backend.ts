import type { DataIssue } from "../../data/index.js";
import { cloneStrictJsonValue } from "../../json/codec.js";
import {
	AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND,
	type AgenticMemoryCommittedFact,
	type AgenticMemoryCommittedFactBatch,
	type AgenticMemoryCommittedFactCursor,
	type AgenticMemoryCommittedFactLog,
	type AgenticMemoryCommittedFactReadOptions,
	type AgenticMemoryCommittedFactReadResult,
	type AgenticMemoryFactCommitResult,
	type AgenticMemoryFactCommitStatus,
	type AgenticMemoryFactLogAuditEntry,
	assertAgenticMemoryCommittedFact,
	assertAgenticMemoryCommittedFactBatch,
} from "./committed-fact-log.js";
import type { StrictJsonValue } from "./types.js";

export const AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND =
	"agentic-memory-committed-fact-log-backend.cursor";

export type AgenticMemoryCommittedFactLogBackendStatusState =
	| "available"
	| "degraded"
	| "unavailable"
	| "unknown";

export interface AgenticMemoryCommittedFactLogBackendCursor {
	readonly kind: typeof AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND;
	readonly backend: string;
	readonly value: StrictJsonValue;
}

export interface AgenticMemoryCommittedFactLogBackendCapability {
	readonly kind: "agentic-memory-committed-fact-log-backend-capability";
	readonly name: string;
	readonly supported: boolean;
	readonly status?: AgenticMemoryCommittedFactLogBackendStatusState;
	readonly details?: StrictJsonValue;
}

export interface AgenticMemoryCommittedFactLogBackendAuditEntry {
	readonly kind: "agentic-memory-committed-fact-log-backend-audit";
	readonly action:
		| "backend-append-attempted"
		| "backend-read-attempted"
		| "backend-result-normalized"
		| "backend-status-reported"
		| "backend-capability-reported"
		| "backend-cursor-reported"
		| "issue-recorded";
	readonly reason?: string;
	readonly backend?: string;
	readonly factLogCursor?: AgenticMemoryCommittedFactCursor;
	readonly backendCursor?: AgenticMemoryCommittedFactLogBackendCursor;
}

export interface AgenticMemoryCommittedFactLogBackendStatus {
	readonly kind: "agentic-memory-committed-fact-log-backend-status";
	readonly state: AgenticMemoryCommittedFactLogBackendStatusState;
	readonly backend?: string;
	readonly capabilities: readonly AgenticMemoryCommittedFactLogBackendCapability[];
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryCommittedFactLogBackendAuditEntry[];
}

export interface AgenticMemoryCommittedFactLogBackendAppendResult {
	readonly status: AgenticMemoryFactCommitStatus;
	readonly cursor: AgenticMemoryCommittedFactCursor;
	readonly facts: number;
	readonly issues?: readonly DataIssue[];
	readonly audit?: readonly AgenticMemoryFactLogAuditEntry[];
	readonly backendStatus?: AgenticMemoryCommittedFactLogBackendStatus;
	readonly backendCursor?: AgenticMemoryCommittedFactLogBackendCursor;
}

export interface AgenticMemoryCommittedFactLogBackendReadResult<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly facts: readonly AgenticMemoryCommittedFact<TJson>[];
	readonly cursor: AgenticMemoryCommittedFactCursor;
	readonly done: boolean;
	readonly issues?: readonly DataIssue[];
	readonly audit?: readonly AgenticMemoryFactLogAuditEntry[];
	readonly backendStatus?: AgenticMemoryCommittedFactLogBackendStatus;
	readonly backendCursor?: AgenticMemoryCommittedFactLogBackendCursor;
}

export interface AgenticMemoryCommittedFactLogBackend<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly kind?: "agentic-memory-committed-fact-log-backend";
	readonly status?:
		| AgenticMemoryCommittedFactLogBackendStatus
		| (() =>
				| AgenticMemoryCommittedFactLogBackendStatus
				| PromiseLike<AgenticMemoryCommittedFactLogBackendStatus>);
	append(
		batch: AgenticMemoryCommittedFactBatch<TJson>,
	):
		| AgenticMemoryCommittedFactLogBackendAppendResult
		| PromiseLike<AgenticMemoryCommittedFactLogBackendAppendResult>;
	read(
		opts?: AgenticMemoryCommittedFactReadOptions,
	):
		| AgenticMemoryCommittedFactLogBackendReadResult<TJson>
		| PromiseLike<AgenticMemoryCommittedFactLogBackendReadResult<TJson>>;
}

/** Build D592 backend status DATA.
 *
 * Backend status is diagnostic DATA only. It does not define protocol
 * semantics, acknowledge application success, mutate records, hydrate/restore
 * graph state, refresh subscribers, or create a graph commit barrier.
 *
 * @param state - Backend availability/status classification.
 * @param opts - Optional backend name, capabilities, issues, and audit entries.
 * @returns A normalized D592 backend status DATA object.
 * @category solutions
 */
export function agenticMemoryCommittedFactLogBackendStatus(
	state: AgenticMemoryCommittedFactLogBackendStatusState,
	opts: {
		readonly backend?: string;
		readonly capabilities?: readonly AgenticMemoryCommittedFactLogBackendCapability[];
		readonly issues?: readonly DataIssue[];
		readonly audit?: readonly AgenticMemoryCommittedFactLogBackendAuditEntry[];
	} = {},
): AgenticMemoryCommittedFactLogBackendStatus {
	validateBackendStatusState(state);
	return Object.freeze({
		kind: "agentic-memory-committed-fact-log-backend-status",
		state,
		...(opts.backend === undefined ? {} : { backend: opts.backend }),
		capabilities: Object.freeze(
			(opts.capabilities ?? []).map((capability) => normalizeCapability(capability)),
		),
		issues: Object.freeze((opts.issues ?? []).map(freezeIssue)),
		audit: Object.freeze((opts.audit ?? []).map(normalizeBackendAudit)),
	});
}

/** Build a D592 backend cursor DATA object.
 *
 * The returned cursor is intentionally not an
 * `AgenticMemoryCommittedFactCursor`; it may be reported through diagnostics
 * or audit DATA, but it must never become a D589 fact-stream cursor.
 *
 * @param backend - Backend identifier.
 * @param value - Backend-owned cursor/offset value.
 * @returns A backend cursor diagnostic DATA object.
 * @category solutions
 */
export function agenticMemoryCommittedFactLogBackendCursor(
	backend: string,
	value: StrictJsonValue,
): AgenticMemoryCommittedFactLogBackendCursor {
	if (!isNonEmptyString(backend)) {
		throw new TypeError("agenticMemoryCommittedFactLogBackendCursor: backend must be non-empty");
	}
	return Object.freeze({
		kind: AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND,
		backend,
		value: cloneStrictJsonValue(value, "backendCursor.value") as StrictJsonValue,
	});
}

/** Normalize a D592 backend append output into D589 commit result DATA.
 *
 * The normalized result describes committed fact-log persistence only. Backend
 * diagnostics are preserved as issues/audit DATA and never become application
 * acknowledgement, live graph truth, record mutation authority, hot hydration,
 * restore, or a graph commit barrier.
 *
 * @param output - Backend-supplied append output.
 * @param opts - Optional fallback fact-stream cursor for malformed outputs.
 * @returns A D589 `AgenticMemoryFactCommitResult`.
 * @category solutions
 */
export function normalizeAgenticMemoryCommittedFactLogBackendAppendResult(
	output: unknown,
	opts: {
		readonly fallbackCursor?: AgenticMemoryCommittedFactCursor;
		readonly expectedFacts?: number;
	} = {},
): AgenticMemoryFactCommitResult {
	const fallbackCursor = freezeFactCursor(opts.fallbackCursor ?? factCursor(0));
	let cloned: unknown;
	try {
		cloned = cloneStrictJsonValue(output, "agenticMemoryCommittedFactLogBackendAppendResult");
	} catch (error) {
		return appendResult("uncertain", fallbackCursor, 0, [
			issue(
				"agentic-memory.fact-log-backend.invalid-append-result",
				error instanceof Error ? error.message : String(error),
			),
		]);
	}
	if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
		return appendResult("rejected", fallbackCursor, 0, [
			issue(
				"agentic-memory.fact-log-backend.invalid-append-result",
				"backend append result must be an object",
			),
		]);
	}

	const raw = cloned as Partial<AgenticMemoryCommittedFactLogBackendAppendResult>;
	const issues: DataIssue[] = [];
	const status = isCommitStatus(raw.status) ? raw.status : undefined;
	if (status === undefined) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.invalid-append-status",
				"backend append result status is not a D589 commit status",
			),
		);
	}
	const cursor = validateFactCursor(raw.cursor);
	if (cursor === undefined) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.invalid-fact-cursor",
				"backend append result cursor must be an AgenticMemory fact-stream cursor",
			),
		);
	}
	const rawFacts = raw.facts;
	const facts =
		typeof rawFacts === "number" && Number.isSafeInteger(rawFacts) && rawFacts >= 0
			? rawFacts
			: undefined;
	if (facts === undefined) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.invalid-facts-count",
				"backend append result facts must be a non-negative safe integer",
			),
		);
	}
	if (opts.expectedFacts !== undefined && !isNonNegativeSafeInteger(opts.expectedFacts)) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.invalid-expected-facts-count",
				"expected append facts must be a non-negative safe integer",
			),
		);
	}
	const committedFactsMismatch =
		status === "committed" &&
		facts !== undefined &&
		opts.expectedFacts !== undefined &&
		isNonNegativeSafeInteger(opts.expectedFacts) &&
		facts !== opts.expectedFacts;
	if (committedFactsMismatch) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.committed-facts-mismatch",
				"backend committed append result must cover the whole submitted fact batch",
				{ details: { expectedFacts: opts.expectedFacts, reportedFacts: facts } },
			),
		);
	}
	const backendStatus = normalizeOptionalBackendStatus(raw.backendStatus, issues);
	issues.push(...normalizeIssues(raw.issues));
	const audit = normalizeFactLogAudit(raw.audit, issues);
	let backendCursor: AgenticMemoryCommittedFactLogBackendCursor | undefined;
	if (raw.backendCursor !== undefined) {
		backendCursor = validateBackendCursor(raw.backendCursor);
		if (backendCursor === undefined) {
			issues.push(
				issue(
					"agentic-memory.fact-log-backend.invalid-backend-cursor",
					"backend cursor must be diagnostic DATA and cannot replace the fact-stream cursor",
				),
			);
		}
	}
	if (backendStatus?.state === "degraded" || backendStatus?.state === "unavailable") {
		issues.push(
			issue("agentic-memory.fact-log-backend.status", `backend status is ${backendStatus.state}`, {
				severity: backendStatus.state === "degraded" ? "warning" : "error",
			}),
		);
	}
	if (backendStatus !== undefined) issues.push(...backendStatus.issues);

	const publicStatus = committedFactsMismatch
		? "uncertain"
		: status === undefined
			? "rejected"
			: (cursor === undefined || facts === undefined) &&
					(status === "committed" || status === "duplicate" || status === "uncertain")
				? "uncertain"
				: status;
	return appendResult(
		publicStatus,
		committedFactsMismatch ? fallbackCursor : (cursor ?? fallbackCursor),
		committedFactsMismatch ? 0 : (facts ?? 0),
		issues,
		[
			...audit,
			...backendDiagnosticAudit("backend-append-normalized", backendStatus, backendCursor),
		],
	);
}

/** Normalize a D592 backend read output into D589 read result DATA.
 *
 * Reads remain stream-ordered committed facts with a D589 fact-stream cursor.
 * Backend cursors/diagnostics are audit or issue DATA only and are never used
 * as fact-log cursors or replay/materialization authority.
 *
 * @param output - Backend-supplied read output.
 * @param opts - Optional fallback fact-stream cursor for malformed outputs.
 * @returns A D589 `AgenticMemoryCommittedFactReadResult`.
 * @category solutions
 */
export function normalizeAgenticMemoryCommittedFactLogBackendReadResult<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	output: unknown,
	opts: { readonly fallbackCursor?: AgenticMemoryCommittedFactCursor } = {},
): AgenticMemoryCommittedFactReadResult<TJson> {
	const fallbackCursor = freezeFactCursor(opts.fallbackCursor ?? factCursor(0));
	let cloned: unknown;
	try {
		cloned = cloneStrictJsonValue(output, "agenticMemoryCommittedFactLogBackendReadResult");
	} catch (error) {
		return readResult(Object.freeze([]), fallbackCursor, false, [
			issue(
				"agentic-memory.fact-log-backend.invalid-read-result",
				error instanceof Error ? error.message : String(error),
			),
		]);
	}
	if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
		return readResult(Object.freeze([]), fallbackCursor, false, [
			issue(
				"agentic-memory.fact-log-backend.invalid-read-result",
				"backend read result must be an object",
			),
		]);
	}

	const raw = cloned as Partial<AgenticMemoryCommittedFactLogBackendReadResult<TJson>>;
	const issues: DataIssue[] = [];
	const cursor = validateFactCursor(raw.cursor);
	if (cursor === undefined) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.invalid-fact-cursor",
				"backend read result cursor must be an AgenticMemory fact-stream cursor",
			),
		);
	}
	const done = typeof raw.done === "boolean" ? raw.done : undefined;
	if (done === undefined) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.invalid-read-done",
				"backend read result done must be boolean",
			),
		);
	}
	const facts: AgenticMemoryCommittedFact<TJson>[] = [];
	if (!Array.isArray(raw.facts)) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.invalid-read-facts",
				"backend read result facts must be an array",
			),
		);
	} else {
		for (let index = 0; index < raw.facts.length; index += 1) {
			try {
				facts.push(assertAgenticMemoryCommittedFact<TJson>(raw.facts[index]));
			} catch (error) {
				issues.push(
					issue(
						"agentic-memory.fact-log-backend.invalid-read-fact",
						error instanceof Error ? error.message : String(error),
						{ path: [index] },
					),
				);
			}
		}
	}
	const backendStatus = normalizeOptionalBackendStatus(raw.backendStatus, issues);
	issues.push(...normalizeIssues(raw.issues));
	const audit = normalizeFactLogAudit(raw.audit, issues);
	let backendCursor: AgenticMemoryCommittedFactLogBackendCursor | undefined;
	if (raw.backendCursor !== undefined) {
		backendCursor = validateBackendCursor(raw.backendCursor);
	}
	if (raw.backendCursor !== undefined && backendCursor === undefined) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.invalid-backend-cursor",
				"backend cursor must be diagnostic DATA and cannot replace the fact-stream cursor",
			),
		);
	}
	if (backendStatus?.state === "degraded" || backendStatus?.state === "unavailable") {
		issues.push(
			issue("agentic-memory.fact-log-backend.status", `backend status is ${backendStatus.state}`, {
				severity: backendStatus.state === "degraded" ? "warning" : "error",
			}),
		);
	}
	if (backendStatus !== undefined) issues.push(...backendStatus.issues);
	const validFacts = issues.some((item) =>
		item.code.startsWith("agentic-memory.fact-log-backend.invalid-read-fact"),
	)
		? Object.freeze([])
		: Object.freeze(facts);
	const cursorCoversFacts =
		cursor !== undefined && cursor.position >= fallbackCursor.position + validFacts.length;
	if (!cursorCoversFacts) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.invalid-read-cursor-coverage",
				"backend read cursor must not regress and must cover returned committed facts",
				{
					details: {
						fallbackPosition: fallbackCursor.position,
						reportedPosition: cursor?.position ?? null,
						facts: validFacts.length,
					},
				},
			),
		);
	}
	return readResult<TJson>(
		cursorCoversFacts ? validFacts : Object.freeze([]),
		cursorCoversFacts ? cursor : fallbackCursor,
		cursorCoversFacts ? (done ?? false) : false,
		issues,
		[...audit, ...backendDiagnosticAudit("backend-read-normalized", backendStatus, backendCursor)],
	);
}

/** Wrap a D592 backend as the existing D589 committed fact-log interface.
 *
 * The wrapper only canonicalizes append input and normalizes backend append/read
 * outputs. It does not add storage semantics, materialize records, replay facts
 * into application state, hydrate/restore graphs, refresh subscribers, or turn a
 * backend result into application acknowledgement or a graph commit barrier.
 *
 * @param backend - Backend implementation for physical append/read attempts.
 * @returns A D589 `AgenticMemoryCommittedFactLog` view over the backend.
 * @category solutions
 */
export function agenticMemoryCommittedFactLogBackendAdapter<
	TJson extends StrictJsonValue = StrictJsonValue,
>(backend: AgenticMemoryCommittedFactLogBackend<TJson>): AgenticMemoryCommittedFactLog<TJson> {
	return {
		append(batch) {
			let canonical: AgenticMemoryCommittedFactBatch<TJson>;
			try {
				canonical = assertAgenticMemoryCommittedFactBatch<TJson>(batch);
			} catch (error) {
				return appendResult("rejected", factCursor(0), 0, [
					issue(
						"agentic-memory.fact-log-backend.invalid-append-batch",
						error instanceof Error ? error.message : String(error),
					),
				]);
			}
			try {
				const out = backend.append(canonical);
				return isPromiseLike(out)
					? out.then(
							(value) => {
								try {
									return normalizeAgenticMemoryCommittedFactLogBackendAppendResult(value, {
										expectedFacts: canonical.facts.length,
									});
								} catch (error) {
									return appendResult("uncertain", factCursor(0), 0, [
										issue(
											"agentic-memory.fact-log-backend.append-normalization-threw",
											error instanceof Error ? error.message : String(error),
										),
									]);
								}
							},
							(error) =>
								appendResult("uncertain", factCursor(0), 0, [
									issue(
										"agentic-memory.fact-log-backend.append-threw",
										error instanceof Error ? error.message : String(error),
									),
								]),
						)
					: normalizeAgenticMemoryCommittedFactLogBackendAppendResult(out, {
							expectedFacts: canonical.facts.length,
						});
			} catch (error) {
				return appendResult("uncertain", factCursor(0), 0, [
					issue(
						"agentic-memory.fact-log-backend.append-threw",
						error instanceof Error ? error.message : String(error),
					),
				]);
			}
		},
		read(opts) {
			const fallback = readFallbackCursor(opts);
			if (fallback.issue !== undefined) {
				return readResult<TJson>(Object.freeze([]), fallback.cursor, false, [fallback.issue]);
			}
			try {
				const out = backend.read(opts);
				return isPromiseLike(out)
					? out.then(
							(value) => {
								try {
									return normalizeAgenticMemoryCommittedFactLogBackendReadResult<TJson>(value, {
										fallbackCursor: fallback.cursor,
									});
								} catch (error) {
									return readResult<TJson>(Object.freeze([]), fallback.cursor, false, [
										issue(
											"agentic-memory.fact-log-backend.read-normalization-threw",
											error instanceof Error ? error.message : String(error),
										),
									]);
								}
							},
							(error) =>
								readResult<TJson>(Object.freeze([]), fallback.cursor, false, [
									issue(
										"agentic-memory.fact-log-backend.read-threw",
										error instanceof Error ? error.message : String(error),
									),
								]),
						)
					: normalizeAgenticMemoryCommittedFactLogBackendReadResult<TJson>(out, {
							fallbackCursor: fallback.cursor,
						});
			} catch (error) {
				return readResult<TJson>(Object.freeze([]), fallback.cursor, false, [
					issue(
						"agentic-memory.fact-log-backend.read-threw",
						error instanceof Error ? error.message : String(error),
					),
				]);
			}
		},
	};
}

function appendResult(
	status: AgenticMemoryFactCommitStatus,
	cursor: AgenticMemoryCommittedFactCursor,
	facts: number,
	issues: readonly DataIssue[],
	extraAudit: readonly AgenticMemoryFactLogAuditEntry[] = [],
): AgenticMemoryFactCommitResult {
	const action: AgenticMemoryFactLogAuditEntry["action"] =
		status === "committed"
			? "batch-committed"
			: status === "duplicate"
				? "batch-duplicate"
				: status === "conflict"
					? "batch-conflict"
					: status === "rejected"
						? "batch-rejected"
						: "batch-uncertain";
	return Object.freeze({
		status,
		cursor: freezeFactCursor(cursor),
		facts,
		issues: Object.freeze(issues.map(freezeIssue)),
		audit: Object.freeze([
			auditEntry(action, { cursor }),
			...extraAudit,
			...issues.map((item) => auditEntry("issue-recorded", { reason: item.code })),
		]),
	});
}

function readResult<TJson extends StrictJsonValue>(
	facts: readonly AgenticMemoryCommittedFact<TJson>[],
	cursor: AgenticMemoryCommittedFactCursor,
	done: boolean,
	issues: readonly DataIssue[],
	extraAudit: readonly AgenticMemoryFactLogAuditEntry[] = [],
): AgenticMemoryCommittedFactReadResult<TJson> {
	return Object.freeze({
		facts: Object.freeze([...facts]),
		cursor: freezeFactCursor(cursor),
		done,
		issues: Object.freeze(issues.map(freezeIssue)),
		audit: Object.freeze([
			auditEntry("facts-read", { cursor, reason: `${facts.length} facts` }),
			...extraAudit,
			...issues.map((item) => auditEntry("issue-recorded", { reason: item.code })),
		]),
	});
}

function backendDiagnosticAudit(
	action: "backend-append-normalized" | "backend-read-normalized",
	status: AgenticMemoryCommittedFactLogBackendStatus | undefined,
	cursor: AgenticMemoryCommittedFactLogBackendCursor | undefined,
): readonly AgenticMemoryFactLogAuditEntry[] {
	const audit: AgenticMemoryFactLogAuditEntry[] = [auditEntry(action)];
	if (status !== undefined) {
		audit.push(
			auditEntry("backend-status-linked", {
				reason: `backend status ${status.state}`,
			}),
		);
		for (const capability of status.capabilities) {
			audit.push(
				auditEntry("backend-capability-linked", {
					reason: `${capability.name}:${capability.supported ? "supported" : "unsupported"}`,
				}),
			);
		}
	}
	if (cursor !== undefined) {
		audit.push(
			auditEntry("backend-cursor-linked", {
				reason: "backend cursor reported as diagnostic DATA, not fact-stream cursor",
			}),
		);
	}
	return Object.freeze(audit);
}

function normalizeOptionalBackendStatus(
	value: AgenticMemoryCommittedFactLogBackendStatus | undefined,
	issues: DataIssue[],
): AgenticMemoryCommittedFactLogBackendStatus | undefined {
	if (value === undefined) return undefined;
	try {
		const cloned = cloneStrictJsonValue(value, "backendStatus");
		if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
			throw new TypeError("backendStatus must be an object");
		}
		const status = cloned as unknown as AgenticMemoryCommittedFactLogBackendStatus;
		return agenticMemoryCommittedFactLogBackendStatus(status.state, {
			backend: status.backend,
			capabilities: status.capabilities,
			issues: status.issues,
			audit: status.audit,
		});
	} catch (error) {
		issues.push(
			issue(
				"agentic-memory.fact-log-backend.invalid-status",
				error instanceof Error ? error.message : String(error),
			),
		);
		return undefined;
	}
}

function normalizeCapability(
	capability: AgenticMemoryCommittedFactLogBackendCapability,
): AgenticMemoryCommittedFactLogBackendCapability {
	if (capability?.kind !== "agentic-memory-committed-fact-log-backend-capability") {
		throw new TypeError("agenticMemoryCommittedFactLogBackendStatus: invalid capability kind");
	}
	if (!isNonEmptyString(capability.name)) {
		throw new TypeError("agenticMemoryCommittedFactLogBackendStatus: capability name required");
	}
	if (typeof capability.supported !== "boolean") {
		throw new TypeError("agenticMemoryCommittedFactLogBackendStatus: supported must be boolean");
	}
	if (capability.status !== undefined) validateBackendStatusState(capability.status);
	return Object.freeze({
		kind: "agentic-memory-committed-fact-log-backend-capability",
		name: capability.name,
		supported: capability.supported,
		...(capability.status === undefined ? {} : { status: capability.status }),
		...(capability.details === undefined
			? {}
			: {
					details: cloneStrictJsonValue(
						capability.details,
						"capability.details",
					) as StrictJsonValue,
				}),
	});
}

function normalizeBackendAudit(
	entry: AgenticMemoryCommittedFactLogBackendAuditEntry,
): AgenticMemoryCommittedFactLogBackendAuditEntry {
	if (entry?.kind !== "agentic-memory-committed-fact-log-backend-audit") {
		throw new TypeError("agenticMemoryCommittedFactLogBackendStatus: invalid backend audit kind");
	}
	if (!isBackendAuditAction(entry.action)) {
		throw new TypeError("agenticMemoryCommittedFactLogBackendStatus: invalid backend audit action");
	}
	return Object.freeze({
		kind: "agentic-memory-committed-fact-log-backend-audit",
		action: entry.action,
		...(entry.reason === undefined ? {} : { reason: entry.reason }),
		...(entry.backend === undefined ? {} : { backend: entry.backend }),
		...(entry.factLogCursor === undefined
			? {}
			: { factLogCursor: freezeFactCursor(entry.factLogCursor) }),
		...(entry.backendCursor === undefined
			? {}
			: {
					backendCursor: agenticMemoryCommittedFactLogBackendCursor(
						entry.backendCursor.backend,
						entry.backendCursor.value,
					),
				}),
	});
}

function normalizeIssues(values: readonly DataIssue[] | undefined): readonly DataIssue[] {
	if (values === undefined) return Object.freeze([]);
	if (!Array.isArray(values)) {
		return Object.freeze([
			issue("agentic-memory.fact-log-backend.invalid-issues", "backend issues must be an array"),
		]);
	}
	const issues: DataIssue[] = [];
	for (let index = 0; index < values.length; index += 1) {
		try {
			issues.push(freezeIssue(values[index]!));
		} catch (error) {
			issues.push(
				issue(
					"agentic-memory.fact-log-backend.invalid-issues",
					error instanceof Error ? error.message : String(error),
					{ path: [index] },
				),
			);
		}
	}
	return Object.freeze(issues);
}

function normalizeFactLogAudit(
	values: readonly AgenticMemoryFactLogAuditEntry[] | undefined,
	issues: DataIssue[],
): readonly AgenticMemoryFactLogAuditEntry[] {
	if (values === undefined) return Object.freeze([]);
	if (!Array.isArray(values)) {
		issues.push(
			issue("agentic-memory.fact-log-backend.invalid-audit", "backend audit must be an array"),
		);
		return Object.freeze([]);
	}
	const audit: AgenticMemoryFactLogAuditEntry[] = [];
	for (let index = 0; index < values.length; index += 1) {
		try {
			audit.push(freezeFactLogAuditEntry(values[index]!));
		} catch (error) {
			issues.push(
				issue(
					"agentic-memory.fact-log-backend.invalid-audit",
					error instanceof Error ? error.message : String(error),
					{ path: [index] },
				),
			);
		}
	}
	return Object.freeze(audit);
}

function freezeIssue(value: DataIssue): DataIssue {
	if (value?.kind !== "issue") {
		throw new TypeError("AgenticMemory backend issue must have kind issue");
	}
	if (!isNonEmptyString(value.code) || !isNonEmptyString(value.message)) {
		throw new TypeError("AgenticMemory backend issue code/message must be non-empty");
	}
	if (
		value.severity !== undefined &&
		value.severity !== "info" &&
		value.severity !== "warning" &&
		value.severity !== "error"
	) {
		throw new TypeError("AgenticMemory backend issue severity is invalid");
	}
	return Object.freeze({
		kind: "issue",
		code: value.code,
		message: value.message,
		...(value.severity === undefined ? {} : { severity: value.severity }),
		...(value.source === undefined ? {} : { source: requireString(value.source, "issue.source") }),
		...(value.subjectId === undefined
			? {}
			: { subjectId: requireString(value.subjectId, "issue.subjectId") }),
		...(value.correlationId === undefined
			? {}
			: { correlationId: requireString(value.correlationId, "issue.correlationId") }),
		...(value.causationId === undefined
			? {}
			: { causationId: requireString(value.causationId, "issue.causationId") }),
		...(value.path === undefined ? {} : { path: normalizeIssuePath(value.path) }),
		...(value.refs === undefined ? {} : { refs: normalizeIssueRefs(value.refs) }),
		...(value.retryable === undefined
			? {}
			: { retryable: requireBoolean(value.retryable, "issue.retryable") }),
		...(value.details === undefined
			? {}
			: { details: cloneStrictJsonValue(value.details, "issue.details") }),
		...(value.metadata === undefined ? {} : { metadata: normalizeIssueMetadata(value.metadata) }),
	}) as DataIssue;
}

function freezeFactLogAuditEntry(
	entry: AgenticMemoryFactLogAuditEntry,
): AgenticMemoryFactLogAuditEntry {
	if (entry?.kind !== "agentic-memory-fact-log-audit") {
		throw new TypeError("AgenticMemory fact-log audit kind is invalid");
	}
	if (!isFactLogAuditAction(entry.action)) {
		throw new TypeError("AgenticMemory fact-log audit action is invalid");
	}
	return deepFreezeStrict({
		...entry,
		...(entry.cursor === undefined ? {} : { cursor: freezeFactCursor(entry.cursor) }),
	}) as AgenticMemoryFactLogAuditEntry;
}

function auditEntry(
	action: AgenticMemoryFactLogAuditEntry["action"],
	fields: Omit<AgenticMemoryFactLogAuditEntry, "kind" | "action"> = {},
): AgenticMemoryFactLogAuditEntry {
	return Object.freeze({
		kind: "agentic-memory-fact-log-audit",
		action,
		...fields,
	});
}

function validateBackendCursor(
	value: AgenticMemoryCommittedFactLogBackendCursor,
): AgenticMemoryCommittedFactLogBackendCursor | undefined {
	if (value?.kind !== AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND) return undefined;
	if (!isNonEmptyString(value.backend)) return undefined;
	try {
		return agenticMemoryCommittedFactLogBackendCursor(value.backend, value.value);
	} catch {
		return undefined;
	}
}

function validateFactCursor(
	value: AgenticMemoryCommittedFactCursor | undefined,
): AgenticMemoryCommittedFactCursor | undefined {
	if (value?.kind !== AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND) return undefined;
	if (!Number.isSafeInteger(value.position) || value.position < 0) return undefined;
	return freezeFactCursor(value);
}

function readFallbackCursor(opts: AgenticMemoryCommittedFactReadOptions | undefined): {
	readonly cursor: AgenticMemoryCommittedFactCursor;
	readonly issue?: DataIssue;
} {
	if (opts?.after === undefined) return { cursor: factCursor(0) };
	const cursor = validateFactCursor(opts.after);
	if (cursor !== undefined) return { cursor };
	return {
		cursor: factCursor(0),
		issue: issue(
			"agentic-memory.fact-log-backend.invalid-read-options",
			"read after cursor must be an AgenticMemory fact-stream cursor",
		),
	};
}

function freezeFactCursor(
	cursor: AgenticMemoryCommittedFactCursor,
): AgenticMemoryCommittedFactCursor {
	const valid = validateFactCursorNoFreeze(cursor);
	if (!valid) throw new TypeError("AgenticMemory fact cursor must be a fact-stream cursor");
	return Object.freeze({ kind: cursor.kind, position: cursor.position });
}

function validateFactCursorNoFreeze(cursor: AgenticMemoryCommittedFactCursor): boolean {
	return (
		cursor?.kind === AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND &&
		Number.isSafeInteger(cursor.position) &&
		cursor.position >= 0
	);
}

function factCursor(position: number): AgenticMemoryCommittedFactCursor {
	if (!Number.isSafeInteger(position) || position < 0) {
		throw new RangeError("AgenticMemory fact cursor position must be a non-negative safe integer");
	}
	return Object.freeze({ kind: AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND, position });
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function issue(
	code: string,
	message: string,
	fields: Omit<DataIssue, "kind" | "code" | "message" | "severity"> & {
		readonly severity?: DataIssue["severity"];
	} = {},
): DataIssue {
	const { severity = "error", ...rest } = fields;
	return Object.freeze({ kind: "issue", code, message, severity, ...rest });
}

function isCommitStatus(value: unknown): value is AgenticMemoryFactCommitStatus {
	return (
		value === "committed" ||
		value === "duplicate" ||
		value === "conflict" ||
		value === "rejected" ||
		value === "uncertain"
	);
}

function validateBackendStatusState(
	value: unknown,
): asserts value is AgenticMemoryCommittedFactLogBackendStatusState {
	if (
		value !== "available" &&
		value !== "degraded" &&
		value !== "unavailable" &&
		value !== "unknown"
	) {
		throw new TypeError("AgenticMemory backend status state is invalid");
	}
}

function isBackendAuditAction(
	value: unknown,
): value is AgenticMemoryCommittedFactLogBackendAuditEntry["action"] {
	return (
		value === "backend-append-attempted" ||
		value === "backend-read-attempted" ||
		value === "backend-result-normalized" ||
		value === "backend-status-reported" ||
		value === "backend-capability-reported" ||
		value === "backend-cursor-reported" ||
		value === "issue-recorded"
	);
}

function isFactLogAuditAction(value: unknown): value is AgenticMemoryFactLogAuditEntry["action"] {
	return (
		value === "batch-committed" ||
		value === "batch-duplicate" ||
		value === "batch-conflict" ||
		value === "batch-rejected" ||
		value === "batch-uncertain" ||
		value === "facts-read" ||
		value === "backend-append-normalized" ||
		value === "backend-read-normalized" ||
		value === "backend-status-linked" ||
		value === "backend-capability-linked" ||
		value === "backend-cursor-linked" ||
		value === "issue-recorded"
	);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
	return value;
}

function requireBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
	return value;
}

function normalizeIssuePath(value: unknown): readonly (string | number)[] {
	if (!Array.isArray(value)) throw new TypeError("issue.path must be an array");
	return Object.freeze(
		value.map((item, index) => {
			if (typeof item !== "string" && typeof item !== "number") {
				throw new TypeError(`issue.path[${index}] must be a string or number`);
			}
			if (typeof item === "number" && !Number.isSafeInteger(item)) {
				throw new TypeError(`issue.path[${index}] must be a safe integer`);
			}
			return item;
		}),
	);
}

function normalizeIssueRefs(value: unknown): readonly string[] {
	if (!Array.isArray(value)) throw new TypeError("issue.refs must be an array");
	return Object.freeze(value.map((item, index) => requireString(item, `issue.refs[${index}]`)));
}

function normalizeIssueMetadata(value: unknown): Record<string, unknown> {
	const metadata = cloneStrictJsonValue(value, "issue.metadata");
	if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
		throw new TypeError("issue.metadata must be a strict JSON object");
	}
	return metadata as Record<string, unknown>;
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
	return value !== null && typeof value === "object" && "then" in value;
}

function deepFreezeStrict<T>(value: T): T {
	if (value === null || typeof value !== "object") return value;
	for (const item of Object.values(value)) deepFreezeStrict(item);
	return Object.freeze(value);
}
