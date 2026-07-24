/**
 * Browser-only AgenticMemory committed fact-log reference backends (D594).
 *
 * Import from `@graphrefly/ts/solutions/agentic-memory/browser`; the universal
 * AgenticMemory barrels stay browser-safe without exposing concrete backends.
 */

/// <reference lib="dom" />

import {
	assertCommittedFactStreamIntegrity,
	committedFactBatchDisposition,
	committedFactReadWindow,
} from "../../committed-facts/internal.js";
import type { DataIssue } from "../../data/index.js";
import {
	type IndexedDbAppendLogOptions,
	type IndexedDbBackendSpec,
	indexedDbAppendLog,
} from "../../storage/browser.js";
import {
	AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND,
	type AgenticMemoryCommittedFact,
	type AgenticMemoryCommittedFactBatch,
	type AgenticMemoryCommittedFactCursor,
	type AgenticMemoryFactLogAuditEntry,
	agenticMemoryCommittedFactBatchCodec,
	assertAgenticMemoryCommittedFactBatch,
} from "./committed-fact-log.js";
import {
	type AgenticMemoryCommittedFactLogBackend,
	type AgenticMemoryCommittedFactLogBackendAppendResult,
	type AgenticMemoryCommittedFactLogBackendReadResult,
	agenticMemoryCommittedFactLogBackendCursor,
	agenticMemoryCommittedFactLogBackendStatus,
} from "./committed-fact-log-backend.js";
import type { StrictJsonValue } from "./types.js";

const DEFAULT_PREFIX = "agentic-memory-committed-fact-log";
const BACKEND_ID = "indexeddb-agentic-memory-committed-fact-log";

export interface IndexedDbAgenticMemoryCommittedFactLogBackendOptions<
	TJson extends StrictJsonValue = StrictJsonValue,
> extends Omit<IndexedDbAppendLogOptions<AgenticMemoryCommittedFactBatch<TJson>>, "codec"> {
	/** Diagnostic backend name. It is DATA/audit only, never a fact-stream cursor. */
	readonly backendName?: string;
}

/** Create a browser IndexedDB-backed D594 single-writer committed fact-log backend.
 *
 * The backend implements the D592 adapter contract directly. It appends each
 * canonical D589 committed fact batch as one strict JSON IndexedDB append-log
 * entry so a readable committed stream never exposes a partial batch. Browser
 * transaction completion is treated as a physical adapter durability attempt,
 * not an application acknowledgement, live graph truth, graph commit barrier,
 * fsync promise, or rollback authority. IndexedDB keys and storage cursors are
 * reported only through backend diagnostic DATA; fact-log cursors are computed
 * from committed fact-stream positions and never from IndexedDB keys, row ids,
 * or IDB cursors. The backend serializes calls made through one backend handle,
 * and requires host-enforced single-writer discipline for the same database,
 * object store, and prefix; it does not claim multi-tab or multi-handle writer
 * correctness.
 *
 * This helper does not materialize records, replay facts into application state,
 * hydrate/restore graphs, refresh subscribers, acknowledge applications, mutate
 * live graph truth, or create a graph commit barrier.
 *
 * @param spec - IndexedDB database and object-store specification owned by the host.
 * @param opts - Optional append-log prefix and diagnostic backend name.
 * @returns A D592 committed fact-log backend.
 * @category solutions
 * @example
 * ```ts
 * import { indexedDbAgenticMemoryCommittedFactLogBackend } from "@graphrefly/ts/solutions/agentic-memory/browser";
 *
 * const backend = indexedDbAgenticMemoryCommittedFactLogBackend({
 *   dbName: "agentic-memory",
 *   storeName: "committed-facts",
 * });
 * ```
 */
export function indexedDbAgenticMemoryCommittedFactLogBackend<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	spec: IndexedDbBackendSpec,
	opts: IndexedDbAgenticMemoryCommittedFactLogBackendOptions<TJson> = {},
): AgenticMemoryCommittedFactLogBackend<TJson> {
	const backendName = normalizeBackendName(opts.backendName);
	const prefix = opts.prefix ?? DEFAULT_PREFIX;
	const log = indexedDbAppendLog<AgenticMemoryCommittedFactBatch<TJson>>(spec, {
		...opts,
		prefix,
		codec: agenticMemoryCommittedFactBatchCodec<TJson>(),
	});
	let tail: PromiseLike<unknown> | undefined;

	function enqueue<R>(task: () => R | PromiseLike<R>): R | PromiseLike<R> {
		const run = tail === undefined ? task() : tail.then(task, task);
		if (isPromiseLike(run)) {
			tail = run.then(
				() => undefined,
				() => undefined,
			);
		}
		return run;
	}

	const status = () =>
		agenticMemoryCommittedFactLogBackendStatus("available", {
			backend: backendName,
			capabilities: [
				capability("single-writer", true, {
					mode: "host-enforced-single-writer-for-database-store-prefix",
					dbName: spec.dbName,
					storeName: spec.storeName,
					prefix,
					note: "This handle serializes its own calls; hosts must not run competing writers for the same database/store/prefix",
				}),
				capability("whole-batch-visibility", true, {
					storageEntry: "one committed fact batch per IndexedDB append-log entry",
				}),
				capability("browser-transaction-attempt", true, {
					reason:
						"IndexedDB transaction completion is a physical adapter durability attempt, not a graph commit barrier or fsync guarantee",
				}),
				capability("multi-writer-correctness", false, {
					reason: "D594 IndexedDB reference backend is single-writer",
				}),
				capability("fsync-guarantee", false, {
					reason:
						"browser transaction completion is not claimed as a D589 fsync or permanent durability guarantee",
				}),
			],
		});

	return {
		kind: "agentic-memory-committed-fact-log-backend",
		status,
		append(batch) {
			return enqueue(() => appendCore(batch));
		},
		read(opts = {}) {
			return enqueue(() => readCore(opts));
		},
	};

	function appendCore(
		batch: AgenticMemoryCommittedFactBatch<TJson>,
	):
		| AgenticMemoryCommittedFactLogBackendAppendResult
		| PromiseLike<AgenticMemoryCommittedFactLogBackendAppendResult> {
		let canonical: AgenticMemoryCommittedFactBatch<TJson>;
		try {
			canonical = assertAgenticMemoryCommittedFactBatch<TJson>(batch);
		} catch (error) {
			return appendResult("rejected", factCursor(0), 0, {
				issues: [
					issue("agentic-memory.fact-log-backend.indexeddb.invalid-batch", errorMessage(error)),
				],
			});
		}

		return readAllFacts().then(
			(existing) => {
				const cursorBefore = factCursor(existing.length);
				const disposition = committedFactBatchDisposition(existing, canonical.facts);
				switch (disposition.kind) {
					case "internal-conflict":
						return appendResult("conflict", cursorBefore, 0, {
							issues: [
								issue(
									"agentic-memory.fact-log-backend.indexeddb.internal-identity-conflict",
									"committed fact batch reuses one identity with different material",
									"error",
									disposition.identity,
								),
							],
						});
					case "internal-duplicate":
						return appendResult("rejected", cursorBefore, 0, {
							issues: [
								issue(
									"agentic-memory.fact-log-backend.indexeddb.internal-duplicate-identity",
									"committed fact batch repeats one identity; submit each fact identity once per batch",
									"error",
									disposition.identity,
								),
							],
						});
					case "conflict":
						return appendResult("conflict", cursorBefore, 0, {
							issues: [
								issue(
									"agentic-memory.fact-log-backend.indexeddb.identity-conflict",
									"committed fact identity was reused with different material",
									"error",
									disposition.identity,
								),
							],
						});
					case "duplicate":
						return appendResult("duplicate", cursorBefore, 0);
					case "partial-overlap":
						return appendResult("rejected", cursorBefore, 0, {
							issues: [
								issue(
									"agentic-memory.fact-log-backend.indexeddb.batch-overlaps-committed-log",
									"committed fact batch partially overlaps existing facts; retry by reading the stream cursor",
								),
							],
						});
					case "append":
						break;
				}

				return log.append(canonical).then(
					(entry) => {
						const cursor = factCursor(existing.length + canonical.facts.length);
						return appendResult("committed", cursor, canonical.facts.length, {
							backendCursor: agenticMemoryCommittedFactLogBackendCursor(backendName, {
								indexedDbKey: entry.key,
								appendLogSeq: entry.seq,
							}),
							backendStatus: status(),
							audit: [
								factLogAudit("batch-committed", {
									cursor,
									reason: "IndexedDB append-log entry committed as a whole batch",
								}),
							],
						});
					},
					(error) =>
						appendResult("uncertain", cursorBefore, 0, {
							issues: [
								issue(
									"agentic-memory.fact-log-backend.indexeddb.append-uncertain",
									`physical IndexedDB append outcome cannot be proven: ${errorMessage(error)}`,
									"error",
									canonical.batchIdentity.key,
								),
							],
							backendStatus: agenticMemoryCommittedFactLogBackendStatus("degraded", {
								backend: backendName,
								issues: [
									issue(
										"agentic-memory.fact-log-backend.indexeddb.append-uncertain",
										errorMessage(error),
									),
								],
							}),
						}),
				);
			},
			(error) =>
				appendResult("uncertain", factCursor(0), 0, {
					issues: [
						issue(
							"agentic-memory.fact-log-backend.indexeddb.precondition-read-failed",
							`could not prove preconditions before append: ${errorMessage(error)}`,
						),
					],
					backendStatus: agenticMemoryCommittedFactLogBackendStatus("degraded", {
						backend: backendName,
						issues: [
							issue(
								"agentic-memory.fact-log-backend.indexeddb.precondition-read-failed",
								errorMessage(error),
							),
						],
					}),
				}),
		);
	}

	function readCore(
		opts: Parameters<AgenticMemoryCommittedFactLogBackend<TJson>["read"]>[0] = {},
	):
		| AgenticMemoryCommittedFactLogBackendReadResult<TJson>
		| PromiseLike<AgenticMemoryCommittedFactLogBackendReadResult<TJson>> {
		const rawAfter = Object.hasOwn(opts, "after")
			? (opts as { readonly after?: unknown }).after
			: factCursor(0);
		const afterIssue = validateFactCursor(rawAfter);
		if (afterIssue !== undefined) {
			return readResult([], factCursor(0), false, {
				issues: [afterIssue],
				backendStatus: status(),
			});
		}
		const after = rawAfter as AgenticMemoryCommittedFactCursor;
		const limit = opts.limit ?? Number.POSITIVE_INFINITY;
		if (limit !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(limit) || limit < 0)) {
			return readResult([], after, false, {
				issues: [
					issue(
						"agentic-memory.fact-log-backend.indexeddb.invalid-read-limit",
						"read limit must be a non-negative safe integer or Infinity",
					),
				],
				backendStatus: status(),
			});
		}
		return log.read().then(
			(entries) => {
				try {
					const facts = flattenBatches(entries.map((entry) => entry.value));
					if (after.position > facts.length) {
						return readResult([], after, false, {
							issues: [
								issue(
									"agentic-memory.fact-log-backend.indexeddb.invalid-fact-cursor",
									"fact cursor is beyond the current stream tail",
								),
							],
							backendStatus: status(),
						});
					}
					const window = committedFactReadWindow(facts, after.position, limit);
					const cursor = factCursor(window.position);
					const lastEntry = entries[entries.length - 1];
					return readResult(window.facts, cursor, window.done, {
						backendCursor:
							lastEntry === undefined
								? undefined
								: agenticMemoryCommittedFactLogBackendCursor(backendName, {
										indexedDbKey: lastEntry.key,
										appendLogSeq: lastEntry.seq,
									}),
						backendStatus: status(),
						audit: [
							factLogAudit("facts-read", {
								cursor,
								reason: "IndexedDB backend returned committed facts in fact-stream order",
							}),
						],
					});
				} catch (error) {
					const storedIssue = issue(
						"agentic-memory.fact-log-backend.indexeddb.invalid-stored-stream",
						errorMessage(error),
					);
					return readResult([], after, false, {
						issues: [storedIssue],
						backendStatus: agenticMemoryCommittedFactLogBackendStatus("degraded", {
							backend: backendName,
							issues: [storedIssue],
						}),
					});
				}
			},
			(error) =>
				readResult([], after, false, {
					issues: [
						issue("agentic-memory.fact-log-backend.indexeddb.read-failed", errorMessage(error)),
					],
					backendStatus: agenticMemoryCommittedFactLogBackendStatus("degraded", {
						backend: backendName,
						issues: [
							issue("agentic-memory.fact-log-backend.indexeddb.read-failed", errorMessage(error)),
						],
					}),
				}),
		);
	}

	function readAllFacts(): PromiseLike<readonly AgenticMemoryCommittedFact<TJson>[]> {
		return log.read().then((entries) => flattenBatches(entries.map((entry) => entry.value)));
	}
}

function flattenBatches<TJson extends StrictJsonValue>(
	batches: readonly AgenticMemoryCommittedFactBatch<TJson>[],
): readonly AgenticMemoryCommittedFact<TJson>[] {
	const facts: AgenticMemoryCommittedFact<TJson>[] = [];
	for (const batch of batches) {
		const canonical = assertAgenticMemoryCommittedFactBatch<TJson>(batch);
		facts.push(...canonical.facts);
	}
	assertCommittedFactStreamIntegrity(facts);
	return Object.freeze(facts);
}

function appendResult(
	status: AgenticMemoryCommittedFactLogBackendAppendResult["status"],
	cursor: AgenticMemoryCommittedFactCursor,
	facts: number,
	opts: {
		readonly issues?: readonly DataIssue[];
		readonly audit?: readonly AgenticMemoryFactLogAuditEntry[];
		readonly backendStatus?: AgenticMemoryCommittedFactLogBackendAppendResult["backendStatus"];
		readonly backendCursor?: AgenticMemoryCommittedFactLogBackendAppendResult["backendCursor"];
	} = {},
): AgenticMemoryCommittedFactLogBackendAppendResult {
	return Object.freeze({
		status,
		cursor,
		facts,
		...(opts.issues === undefined ? {} : { issues: Object.freeze([...opts.issues]) }),
		...(opts.audit === undefined ? {} : { audit: Object.freeze([...opts.audit]) }),
		...(opts.backendStatus === undefined ? {} : { backendStatus: opts.backendStatus }),
		...(opts.backendCursor === undefined ? {} : { backendCursor: opts.backendCursor }),
	});
}

function readResult<TJson extends StrictJsonValue>(
	facts: readonly AgenticMemoryCommittedFact<TJson>[],
	cursor: AgenticMemoryCommittedFactCursor,
	done: boolean,
	opts: {
		readonly issues?: readonly DataIssue[];
		readonly audit?: readonly AgenticMemoryFactLogAuditEntry[];
		readonly backendStatus?: AgenticMemoryCommittedFactLogBackendReadResult<TJson>["backendStatus"];
		readonly backendCursor?: AgenticMemoryCommittedFactLogBackendReadResult<TJson>["backendCursor"];
	} = {},
): AgenticMemoryCommittedFactLogBackendReadResult<TJson> {
	return Object.freeze({
		facts: Object.freeze([...facts]),
		cursor,
		done,
		...(opts.issues === undefined ? {} : { issues: Object.freeze([...opts.issues]) }),
		...(opts.audit === undefined ? {} : { audit: Object.freeze([...opts.audit]) }),
		...(opts.backendStatus === undefined ? {} : { backendStatus: opts.backendStatus }),
		...(opts.backendCursor === undefined ? {} : { backendCursor: opts.backendCursor }),
	});
}

function validateFactCursor(cursor: unknown): DataIssue | undefined {
	if (cursor === null || typeof cursor !== "object") {
		return issue(
			"agentic-memory.fact-log-backend.indexeddb.invalid-fact-cursor",
			"read after cursor must be an AgenticMemory fact-stream cursor",
		);
	}
	const candidate = cursor as Partial<AgenticMemoryCommittedFactCursor>;
	const position = candidate.position;
	if (
		candidate.kind !== AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND ||
		position === undefined ||
		!Number.isSafeInteger(position) ||
		position < 0
	) {
		return issue(
			"agentic-memory.fact-log-backend.indexeddb.invalid-fact-cursor",
			"read after cursor must be an AgenticMemory fact-stream cursor",
		);
	}
	return undefined;
}

function factCursor(position: number): AgenticMemoryCommittedFactCursor {
	return Object.freeze({ kind: AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND, position });
}

function normalizeBackendName(value: string | undefined): string {
	return value === undefined || value.length === 0 ? BACKEND_ID : value;
}

function capability(name: string, supported: boolean, details?: StrictJsonValue) {
	return Object.freeze({
		kind: "agentic-memory-committed-fact-log-backend-capability" as const,
		name,
		supported,
		...(details === undefined ? {} : { details }),
	});
}

function issue(
	code: string,
	message: string,
	severity: DataIssue["severity"] = "error",
	subjectId?: string,
): DataIssue {
	return Object.freeze({
		kind: "issue",
		code,
		message,
		severity,
		...(subjectId === undefined ? {} : { subjectId }),
	});
}

function factLogAudit(
	action: AgenticMemoryFactLogAuditEntry["action"],
	fields: Omit<AgenticMemoryFactLogAuditEntry, "kind" | "action"> = {},
): AgenticMemoryFactLogAuditEntry {
	return Object.freeze({ kind: "agentic-memory-fact-log-audit", action, ...fields });
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
	return (
		value !== null &&
		(typeof value === "object" || typeof value === "function") &&
		typeof (value as PromiseLike<T>).then === "function"
	);
}
