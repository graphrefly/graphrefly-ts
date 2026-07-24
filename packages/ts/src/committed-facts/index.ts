/**
 * Reusable committed-fact journal mechanics (D641).
 *
 * This application-infrastructure surface sits over passive storage. Domains
 * retain their fact schemas, validators, materializers, source authority, and
 * restore/bootstrap wiring.
 */

import type { DataIssue } from "../data/index.js";
import {
	cloneStrictJsonValue,
	type StrictJsonValue,
	strictCanonicalJsonBytes,
} from "../json/codec.js";
import type { AppendLogEntry, AppendLogStorageTier } from "../storage/append-log.js";
import {
	assertCommittedFactStreamIntegrity,
	committedFactBatchDisposition,
	committedFactReadWindow,
} from "./internal.js";

export const COMMITTED_FACT_JOURNAL_CURSOR_KIND = "committed-fact-journal.cursor";

export type CommittedFactJournalCommitStatus =
	| "committed"
	| "duplicate"
	| "conflict"
	| "rejected"
	| "uncertain";

export type CommittedFactJournalBackendStatusState =
	| "available"
	| "degraded"
	| "unavailable"
	| "unknown";

export interface CommittedFactJournalIdentity {
	readonly key: string;
}

/**
 * Minimal structural contract required by the journal.
 *
 * Domain facts may contain any additional strict-JSON fields. The journal
 * compares identities only; it never interprets domain material.
 */
export interface CommittedFactJournalFact {
	readonly identity: CommittedFactJournalIdentity;
	readonly materialIdentity: CommittedFactJournalIdentity;
}

/** One domain-owned canonical fact batch persisted as one storage entry. */
export interface CommittedFactJournalBatch<
	TFact extends CommittedFactJournalFact = CommittedFactJournalFact,
> {
	readonly batchIdentity: CommittedFactJournalIdentity;
	readonly facts: readonly TFact[];
}

/** Default domain-neutral fact-stream cursor. Never a backend row/key cursor. */
export interface CommittedFactJournalCursor {
	readonly kind: typeof COMMITTED_FACT_JOURNAL_CURSOR_KIND;
	readonly stream: string;
	readonly position: number;
}

export interface CommittedFactJournalReadOptions<TCursor = CommittedFactJournalCursor> {
	readonly after?: TCursor;
	readonly limit?: number;
}

export interface CommittedFactJournalBackendCursor {
	readonly kind: "committed-fact-journal-backend.cursor";
	readonly backend: string;
	readonly value: StrictJsonValue;
}

export interface CommittedFactJournalBackendCapability {
	readonly kind: "committed-fact-journal-backend-capability";
	readonly name: string;
	readonly supported: boolean;
	readonly status?: CommittedFactJournalBackendStatusState;
	readonly details?: StrictJsonValue;
}

export interface CommittedFactJournalBackendStatus {
	readonly kind: "committed-fact-journal-backend-status";
	readonly state: CommittedFactJournalBackendStatusState;
	readonly backend: string;
	readonly capabilities: readonly CommittedFactJournalBackendCapability[];
	readonly issues: readonly DataIssue[];
}

export interface CommittedFactJournalAuditEntry<TCursor = CommittedFactJournalCursor> {
	readonly kind: "committed-fact-journal-audit";
	readonly action:
		| "batch-committed"
		| "batch-duplicate"
		| "batch-conflict"
		| "batch-rejected"
		| "batch-uncertain"
		| "facts-read"
		| "backend-status-linked"
		| "backend-cursor-linked"
		| "issue-recorded";
	readonly reason?: string;
	readonly identity?: string;
	readonly cursor?: TCursor;
}

export interface CommittedFactJournalAppendResult<TCursor = CommittedFactJournalCursor> {
	readonly status: CommittedFactJournalCommitStatus;
	readonly cursor: TCursor;
	readonly facts: number;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly CommittedFactJournalAuditEntry<TCursor>[];
	readonly backendStatus?: CommittedFactJournalBackendStatus;
	readonly backendCursor?: CommittedFactJournalBackendCursor;
}

export interface CommittedFactJournalReadResult<
	TFact extends CommittedFactJournalFact = CommittedFactJournalFact,
	TCursor = CommittedFactJournalCursor,
> {
	readonly facts: readonly TFact[];
	readonly cursor: TCursor;
	readonly done: boolean;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly CommittedFactJournalAuditEntry<TCursor>[];
	readonly backendStatus?: CommittedFactJournalBackendStatus;
	readonly backendCursor?: CommittedFactJournalBackendCursor;
}

/**
 * Domain-neutral append/read port.
 *
 * Result type parameters let a domain retain a focused diagnostic vocabulary
 * while still specializing the same journal mechanics.
 */
export interface CommittedFactJournalBackend<
	TBatch extends CommittedFactJournalBatch<TFact>,
	TFact extends CommittedFactJournalFact,
	TCursor,
	TAppendResult extends {
		readonly status: CommittedFactJournalCommitStatus;
		readonly cursor: TCursor;
		readonly facts: number;
		readonly issues: readonly DataIssue[];
		readonly audit: readonly unknown[];
	} = CommittedFactJournalAppendResult<TCursor>,
	TReadResult extends {
		readonly facts: readonly TFact[];
		readonly cursor: TCursor;
		readonly done: boolean;
		readonly issues: readonly DataIssue[];
		readonly audit: readonly unknown[];
	} = CommittedFactJournalReadResult<TFact, TCursor>,
	TStatus extends {
		readonly state: CommittedFactJournalBackendStatusState;
		readonly capabilities: readonly unknown[];
		readonly issues: readonly DataIssue[];
	} = CommittedFactJournalBackendStatus,
> {
	readonly status?: TStatus | (() => TStatus | PromiseLike<TStatus>);
	append(batch: TBatch): TAppendResult | PromiseLike<TAppendResult>;
	read(opts?: CommittedFactJournalReadOptions<TCursor>): TReadResult | PromiseLike<TReadResult>;
}

export interface CommittedFactJournalCursorCodec<TCursor> {
	readonly initial: () => TCursor;
	readonly position: (cursor: unknown) => number;
	readonly fromPosition: (position: number) => TCursor;
}

/**
 * Domain profile required by the append-log journal.
 *
 * Validation and cursor vocabulary remain domain-owned. The journal first
 * rejects non-strict-JSON input, then invokes `assertBatch`.
 */
export interface CommittedFactJournalProfile<
	TFact extends CommittedFactJournalFact,
	TBatch extends CommittedFactJournalBatch<TFact>,
	TCursor,
> {
	readonly assertBatch: (value: unknown) => TBatch;
	readonly cursor: CommittedFactJournalCursorCodec<TCursor>;
}

export interface AppendLogCommittedFactJournalOptions<
	TFact extends CommittedFactJournalFact,
	TBatch extends CommittedFactJournalBatch<TFact>,
	TCursor = CommittedFactJournalCursor,
> {
	readonly log: AppendLogStorageTier<TBatch>;
	readonly profile: CommittedFactJournalProfile<TFact, TBatch, TCursor>;
	readonly backendName?: string;
	readonly issueCodePrefix?: string;
	readonly capabilities?: readonly CommittedFactJournalBackendCapability[];
	readonly backendCursorValue?: (entry: AppendLogEntry<TBatch>) => StrictJsonValue;
}

/** Build the default domain-neutral cursor codec for one named fact stream.
 * @param stream - Stable domain-owned stream identifier.
 * @returns A strict fact-position cursor codec scoped to `stream`.
 * @category committed-facts
 * @example
 * ```ts
 * import { committedFactJournalCursorCodec } from "@graphrefly/ts/committed-facts";
 *
 * const cursor = committedFactJournalCursorCodec("work-facts").initial();
 * ```
 */
export function committedFactJournalCursorCodec(
	stream: string,
): CommittedFactJournalCursorCodec<CommittedFactJournalCursor> {
	const normalized = requireNonEmptyString(stream, "committedFactJournalCursorCodec.stream");
	return Object.freeze({
		initial: () => committedFactJournalCursor(normalized, 0),
		position(cursor: unknown): number {
			if (
				!isRecord(cursor) ||
				cursor.kind !== COMMITTED_FACT_JOURNAL_CURSOR_KIND ||
				cursor.stream !== normalized ||
				!isNonNegativeSafeInteger(cursor.position)
			) {
				throw new TypeError(
					"committed fact journal cursor must match the configured stream and position",
				);
			}
			return cursor.position;
		},
		fromPosition: (position: number) => committedFactJournalCursor(normalized, position),
	});
}

/** Create one immutable domain-neutral fact-stream cursor.
 * @param stream - Stable domain-owned stream identifier.
 * @param position - Non-negative safe-integer fact position.
 * @returns A frozen strict-JSON fact-stream cursor.
 * @category committed-facts
 * @example
 * ```ts
 * import { committedFactJournalCursor } from "@graphrefly/ts/committed-facts";
 *
 * const cursor = committedFactJournalCursor("work-facts", 0);
 * ```
 */
export function committedFactJournalCursor(
	stream: string,
	position: number,
): CommittedFactJournalCursor {
	return Object.freeze({
		kind: COMMITTED_FACT_JOURNAL_CURSOR_KIND,
		stream: requireNonEmptyString(stream, "committedFactJournalCursor.stream"),
		position: requirePosition(position, "committedFactJournalCursor.position"),
	});
}

/**
 * Build a single-writer committed-fact journal over one passive append log.
 *
 * One canonical batch is one storage entry, so readable storage never exposes
 * a partial batch. Calls through one handle are serialized. Competing handles,
 * retention, migration, restore, hot hydration, and domain materialization are
 * deliberately outside this contract.
 * @param opts - Passive append log, domain validator/cursor profile, and bounded diagnostics.
 * @returns A serialized domain-neutral committed-fact journal handle.
 * @category committed-facts
 * @example
 * ```ts
 * import { appendLogCommittedFactJournal } from "@graphrefly/ts/committed-facts";
 * import { memoryAppendLog } from "@graphrefly/ts/storage";
 *
 * const journal = appendLogCommittedFactJournal({
 *   log: memoryAppendLog("work-facts"),
 *   profile,
 * });
 * ```
 */
export function appendLogCommittedFactJournal<
	TFact extends CommittedFactJournalFact,
	TBatch extends CommittedFactJournalBatch<TFact>,
	TCursor = CommittedFactJournalCursor,
>(
	opts: AppendLogCommittedFactJournalOptions<TFact, TBatch, TCursor>,
): CommittedFactJournalBackend<TBatch, TFact, TCursor> {
	const backendName = normalizeName(opts.backendName, "append-log-committed-fact-journal");
	const issuePrefix = normalizeName(opts.issueCodePrefix, "committed-fact-journal.append-log");
	const suppliedCapabilities = opts.capabilities ?? [];
	if (suppliedCapabilities.length > 32) {
		throw new RangeError("committed fact journal supports at most 32 custom capabilities");
	}
	const additionalCapabilities = Object.freeze(suppliedCapabilities.map(normalizeCapability));
	const capabilityNames = new Set([
		"single-writer",
		"whole-batch-visibility",
		"multi-writer-correctness",
	]);
	for (const item of additionalCapabilities) {
		if (capabilityNames.has(item.name)) {
			throw new TypeError(`duplicate or reserved committed fact journal capability: ${item.name}`);
		}
		capabilityNames.add(item.name);
	}
	const initialCursor = canonicalCursor(opts.profile.cursor.initial(), 0, opts.profile.cursor);
	const status = () =>
		backendStatus("available", backendName, [
			capability("single-writer", true, {
				mode: "single-writer-per-journal-handle-and-storage-prefix",
			}),
			capability("whole-batch-visibility", true, {
				storageEntry: "one canonical fact batch per append-log entry",
			}),
			capability("multi-writer-correctness", false),
			...additionalCapabilities,
		]);
	let tail: Promise<unknown> = Promise.resolve();

	function enqueue<R>(task: () => R | PromiseLike<R>): Promise<R> {
		const run = tail.then(task);
		tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	return {
		status,
		append: (batch) => enqueue(() => appendCore(batch)),
		read: (readOptions = {}) => enqueue(() => readCore(readOptions)),
	};

	function appendCore(
		batch: TBatch,
	):
		| CommittedFactJournalAppendResult<TCursor>
		| PromiseLike<CommittedFactJournalAppendResult<TCursor>> {
		let canonical: TBatch;
		try {
			canonical = canonicalBatch(batch, opts.profile);
		} catch (error) {
			return appendResult(
				"rejected",
				initialCursor,
				0,
				[issue(`${issuePrefix}.invalid-batch`, errorMessage(error))],
				status(),
			);
		}

		return readAllFacts().then(
			(existing) => {
				let cursorBefore: TCursor;
				let cursorAfter: TCursor;
				try {
					cursorBefore = cursorAt(existing.length);
					cursorAfter = cursorAt(existing.length + canonical.facts.length);
				} catch (error) {
					return appendResult(
						"rejected",
						initialCursor,
						0,
						[issue(`${issuePrefix}.invalid-profile-cursor`, errorMessage(error))],
						status(),
					);
				}
				const disposition = committedFactBatchDisposition(existing, canonical.facts);
				switch (disposition.kind) {
					case "internal-conflict":
						return appendResult(
							"conflict",
							cursorBefore,
							0,
							[
								issue(
									`${issuePrefix}.internal-identity-conflict`,
									"fact batch reuses one identity with different material",
									disposition.identity,
								),
							],
							status(),
						);
					case "internal-duplicate":
						return appendResult(
							"rejected",
							cursorBefore,
							0,
							[
								issue(
									`${issuePrefix}.internal-duplicate-identity`,
									"fact batch repeats one identity",
									disposition.identity,
								),
							],
							status(),
						);
					case "conflict":
						return appendResult(
							"conflict",
							cursorBefore,
							0,
							[
								issue(
									`${issuePrefix}.identity-conflict`,
									"committed fact identity was reused with different material",
									disposition.identity,
								),
							],
							status(),
						);
					case "duplicate":
						return appendResult("duplicate", cursorBefore, 0, [], status());
					case "partial-overlap":
						return appendResult(
							"rejected",
							cursorBefore,
							0,
							[
								issue(
									`${issuePrefix}.batch-overlaps-committed-log`,
									"fact batch partially overlaps the committed stream",
								),
							],
							status(),
						);
					case "append":
						break;
				}

				return callLogAppend(canonical).then(
					(entry) => {
						const diagnosticIssues: DataIssue[] = [];
						const diagnosticCursor = safeBackendCursor(entry, diagnosticIssues);
						return appendResult(
							"committed",
							cursorAfter,
							canonical.facts.length,
							diagnosticIssues,
							status(),
							diagnosticCursor,
						);
					},
					(error) =>
						appendResult(
							"uncertain",
							cursorBefore,
							0,
							[
								issue(
									`${issuePrefix}.append-uncertain`,
									`physical append outcome cannot be proven: ${errorMessage(error)}`,
									canonical.batchIdentity.key,
								),
							],
							backendStatus(
								"degraded",
								backendName,
								[],
								[issue(`${issuePrefix}.append-uncertain`, errorMessage(error))],
							),
						),
				);
			},
			(error) =>
				appendResult(
					"uncertain",
					initialCursor,
					0,
					[
						issue(
							`${issuePrefix}.precondition-read-failed`,
							`could not prove append preconditions: ${errorMessage(error)}`,
						),
					],
					backendStatus(
						"degraded",
						backendName,
						[],
						[issue(`${issuePrefix}.precondition-read-failed`, errorMessage(error))],
					),
				),
		);
	}

	function readCore(
		readOptions: CommittedFactJournalReadOptions<TCursor>,
	):
		| CommittedFactJournalReadResult<TFact, TCursor>
		| PromiseLike<CommittedFactJournalReadResult<TFact, TCursor>> {
		let after = 0;
		let cursor = initialCursor;
		try {
			if (readOptions.after !== undefined) {
				const canonicalAfter = cloneStrictJsonValue(
					readOptions.after,
					"committedFactJournal.read.after",
				);
				after = requirePosition(opts.profile.cursor.position(canonicalAfter), "cursor.position");
				cursor = cursorAt(after);
			}
		} catch (error) {
			return readResult(
				[],
				cursor,
				false,
				[issue(`${issuePrefix}.invalid-fact-cursor`, errorMessage(error))],
				status(),
			);
		}
		const limit = readOptions.limit ?? Number.POSITIVE_INFINITY;
		if (limit !== Number.POSITIVE_INFINITY && !isNonNegativeSafeInteger(limit)) {
			return readResult(
				[],
				cursor,
				false,
				[
					issue(
						`${issuePrefix}.invalid-read-limit`,
						"read limit must be a non-negative safe integer or Infinity",
					),
				],
				status(),
			);
		}

		return callLogRead().then(
			(entries) => {
				try {
					const facts = flattenBatches(
						entries.map((entry) => entry.value),
						opts.profile,
					);
					if (after > facts.length) {
						return readResult(
							[],
							cursor,
							false,
							[
								issue(
									`${issuePrefix}.invalid-fact-cursor`,
									"fact cursor is beyond the current stream tail",
								),
							],
							status(),
						);
					}
					const window = committedFactReadWindow(facts, after, limit);
					const lastEntry = entries[entries.length - 1];
					const diagnosticIssues: DataIssue[] = [];
					const diagnosticCursor =
						lastEntry === undefined ? undefined : safeBackendCursor(lastEntry, diagnosticIssues);
					return readResult(
						window.facts,
						cursorAt(window.position),
						window.done,
						diagnosticIssues,
						status(),
						diagnosticCursor,
					);
				} catch (error) {
					return readResult(
						[],
						cursor,
						false,
						[issue(`${issuePrefix}.invalid-stored-batch`, errorMessage(error))],
						backendStatus(
							"degraded",
							backendName,
							[],
							[issue(`${issuePrefix}.invalid-stored-batch`, errorMessage(error))],
						),
					);
				}
			},
			(error) =>
				readResult(
					[],
					cursor,
					false,
					[issue(`${issuePrefix}.read-failed`, errorMessage(error))],
					backendStatus(
						"degraded",
						backendName,
						[],
						[issue(`${issuePrefix}.read-failed`, errorMessage(error))],
					),
				),
		);
	}

	function readAllFacts(): PromiseLike<readonly TFact[]> {
		return callLogRead().then((entries) =>
			flattenBatches(
				entries.map((entry) => entry.value),
				opts.profile,
			),
		);
	}

	function callLogAppend(batch: TBatch): Promise<AppendLogEntry<TBatch>> {
		return Promise.resolve().then(() => opts.log.append(batch));
	}

	function callLogRead(): Promise<readonly AppendLogEntry<TBatch>[]> {
		return Promise.resolve().then(() => opts.log.read());
	}

	function cursorAt(position: number): TCursor {
		return canonicalCursor(
			opts.profile.cursor.fromPosition(position),
			position,
			opts.profile.cursor,
		);
	}

	function safeBackendCursor(
		entry: AppendLogEntry<TBatch>,
		issues: DataIssue[],
	): CommittedFactJournalBackendCursor | undefined {
		try {
			return backendCursor(backendName, backendCursorValue(entry, opts));
		} catch (error) {
			issues.push(
				issue(
					`${issuePrefix}.invalid-backend-cursor-diagnostic`,
					errorMessage(error),
					undefined,
					"warning",
				),
			);
			return undefined;
		}
	}
}

function canonicalBatch<
	TFact extends CommittedFactJournalFact,
	TBatch extends CommittedFactJournalBatch<TFact>,
	TCursor,
>(value: unknown, profile: CommittedFactJournalProfile<TFact, TBatch, TCursor>): TBatch {
	const input = cloneStrictJsonValue(value, "committedFactJournal.batch");
	const canonical = cloneStrictJsonValue(
		profile.assertBatch(input),
		"committedFactJournal.profileBatch",
	);
	const batch = canonical as unknown as TBatch;
	assertBatchShape(batch);
	return batch;
}

function assertBatchShape<
	TFact extends CommittedFactJournalFact,
	TBatch extends CommittedFactJournalBatch<TFact>,
>(batch: TBatch): void {
	requireIdentity(batch.batchIdentity, "batchIdentity");
	if (!Array.isArray(batch.facts) || batch.facts.length === 0) {
		throw new TypeError("committed fact journal batch facts must be a non-empty dense array");
	}
	for (let index = 0; index < batch.facts.length; index += 1) {
		if (!Object.hasOwn(batch.facts, index)) {
			throw new TypeError("committed fact journal batch facts must be dense");
		}
		const fact = batch.facts[index];
		if (!isRecord(fact)) throw new TypeError(`facts[${index}] must be an object`);
		requireIdentity(fact.identity, `facts[${index}].identity`);
		requireIdentity(fact.materialIdentity, `facts[${index}].materialIdentity`);
	}
}

function flattenBatches<
	TFact extends CommittedFactJournalFact,
	TBatch extends CommittedFactJournalBatch<TFact>,
	TCursor,
>(
	batches: readonly TBatch[],
	profile: CommittedFactJournalProfile<TFact, TBatch, TCursor>,
): readonly TFact[] {
	const facts: TFact[] = [];
	for (const batch of batches) facts.push(...canonicalBatch(batch, profile).facts);
	assertCommittedFactStreamIntegrity(facts);
	return Object.freeze(facts);
}

function appendResult<TCursor>(
	status: CommittedFactJournalCommitStatus,
	cursor: TCursor,
	facts: number,
	issues: readonly DataIssue[],
	backendStatusValue?: CommittedFactJournalBackendStatus,
	backendCursorValueResult?: CommittedFactJournalBackendCursor,
): CommittedFactJournalAppendResult<TCursor> {
	const action: CommittedFactJournalAuditEntry<TCursor>["action"] =
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
		cursor,
		facts,
		issues: Object.freeze(issues),
		audit: Object.freeze([
			audit<TCursor>(action, { cursor }),
			...(backendStatusValue === undefined
				? []
				: [audit<TCursor>("backend-status-linked", { reason: backendStatusValue.state })]),
			...(backendCursorValueResult === undefined
				? []
				: [
						audit<TCursor>("backend-cursor-linked", {
							reason: "backend cursor is diagnostic DATA only",
						}),
					]),
			...issues.map((item) => audit<TCursor>("issue-recorded", { reason: item.code })),
		]),
		...(backendStatusValue === undefined ? {} : { backendStatus: backendStatusValue }),
		...(backendCursorValueResult === undefined ? {} : { backendCursor: backendCursorValueResult }),
	});
}

function readResult<TFact extends CommittedFactJournalFact, TCursor>(
	facts: readonly TFact[],
	cursor: TCursor,
	done: boolean,
	issues: readonly DataIssue[],
	backendStatusValue?: CommittedFactJournalBackendStatus,
	backendCursorValueResult?: CommittedFactJournalBackendCursor,
): CommittedFactJournalReadResult<TFact, TCursor> {
	return Object.freeze({
		facts: Object.freeze(facts),
		cursor,
		done,
		issues: Object.freeze(issues),
		audit: Object.freeze([
			audit<TCursor>("facts-read", { cursor, reason: `${facts.length} facts` }),
			...(backendStatusValue === undefined
				? []
				: [audit<TCursor>("backend-status-linked", { reason: backendStatusValue.state })]),
			...(backendCursorValueResult === undefined
				? []
				: [
						audit<TCursor>("backend-cursor-linked", {
							reason: "backend cursor is diagnostic DATA only",
						}),
					]),
			...issues.map((item) => audit<TCursor>("issue-recorded", { reason: item.code })),
		]),
		...(backendStatusValue === undefined ? {} : { backendStatus: backendStatusValue }),
		...(backendCursorValueResult === undefined ? {} : { backendCursor: backendCursorValueResult }),
	});
}

function backendStatus(
	state: CommittedFactJournalBackendStatusState,
	backend: string,
	capabilities: readonly CommittedFactJournalBackendCapability[],
	issues: readonly DataIssue[] = [],
): CommittedFactJournalBackendStatus {
	return Object.freeze({
		kind: "committed-fact-journal-backend-status",
		state,
		backend,
		capabilities: Object.freeze(capabilities),
		issues: Object.freeze(issues),
	});
}

function backendCursor(backend: string, value: StrictJsonValue): CommittedFactJournalBackendCursor {
	return Object.freeze({
		kind: "committed-fact-journal-backend.cursor",
		backend,
		value: cloneStrictJsonValue(value, "committedFactJournal.backendCursor"),
	});
}

function backendCursorValue<
	TFact extends CommittedFactJournalFact,
	TBatch extends CommittedFactJournalBatch<TFact>,
	TCursor,
>(
	entry: AppendLogEntry<TBatch>,
	opts: AppendLogCommittedFactJournalOptions<TFact, TBatch, TCursor>,
): StrictJsonValue {
	return opts.backendCursorValue?.(entry) ?? { appendLogSeq: entry.seq, storageKey: entry.key };
}

function capability(
	name: string,
	supported: boolean,
	details?: StrictJsonValue,
): CommittedFactJournalBackendCapability {
	return Object.freeze({
		kind: "committed-fact-journal-backend-capability",
		name,
		supported,
		...(details === undefined ? {} : { details }),
	});
}

function normalizeCapability(
	value: CommittedFactJournalBackendCapability,
): CommittedFactJournalBackendCapability {
	const canonical = cloneStrictJsonValue(
		value,
		"committedFactJournal.capability",
	) as unknown as CommittedFactJournalBackendCapability;
	if (canonical.kind !== "committed-fact-journal-backend-capability") {
		throw new TypeError("invalid committed fact journal backend capability kind");
	}
	const name = boundedText(requireNonEmptyString(canonical.name, "capability.name"), 128);
	if (typeof canonical.supported !== "boolean") {
		throw new TypeError("capability.supported must be boolean");
	}
	if (canonical.status !== undefined && !isBackendStatusState(canonical.status)) {
		throw new TypeError("capability.status must use the committed fact journal status vocabulary");
	}
	if (
		canonical.details !== undefined &&
		strictCanonicalJsonBytes(canonical.details).byteLength > 16_384
	) {
		throw new RangeError("capability.details must not exceed 16384 canonical JSON bytes");
	}
	return Object.freeze({
		kind: "committed-fact-journal-backend-capability",
		name,
		supported: canonical.supported,
		...(canonical.status === undefined ? {} : { status: canonical.status }),
		...(canonical.details === undefined ? {} : { details: canonical.details }),
	});
}

function audit<TCursor>(
	action: CommittedFactJournalAuditEntry<TCursor>["action"],
	fields: Omit<CommittedFactJournalAuditEntry<TCursor>, "kind" | "action"> = {},
): CommittedFactJournalAuditEntry<TCursor> {
	return Object.freeze({ kind: "committed-fact-journal-audit", action, ...fields });
}

function issue(
	code: string,
	message: string,
	subjectId?: string,
	severity: NonNullable<DataIssue["severity"]> = "error",
): DataIssue {
	return Object.freeze({
		kind: "issue",
		code: boundedText(code, 192),
		message: boundedText(message, 1024),
		severity,
		...(subjectId === undefined ? {} : { subjectId: boundedText(subjectId, 256) }),
	});
}

function canonicalCursor<TCursor>(
	value: unknown,
	expectedPosition: number,
	codec: CommittedFactJournalCursorCodec<TCursor>,
): TCursor {
	const canonical = cloneStrictJsonValue(value, "committedFactJournal.cursor");
	const actualPosition = requirePosition(codec.position(canonical), "cursor.position");
	if (actualPosition !== expectedPosition) {
		throw new RangeError(
			`cursor position ${actualPosition} does not match expected position ${expectedPosition}`,
		);
	}
	return canonical as unknown as TCursor;
}

function requireIdentity(
	value: unknown,
	label: string,
): asserts value is CommittedFactJournalIdentity {
	if (!isRecord(value) || typeof value.key !== "string" || value.key.length === 0) {
		throw new TypeError(`${label}.key must be a non-empty string`);
	}
}

function requirePosition(value: number, label: string): number {
	if (!isNonNegativeSafeInteger(value)) {
		throw new RangeError(`${label} must be a non-negative safe integer`);
	}
	return value;
}

function requireNonEmptyString(value: string, label: string): string {
	const canonical = cloneStrictJsonValue(value, label);
	if (typeof canonical !== "string" || canonical.length === 0) {
		throw new TypeError(`${label} must be a non-empty strict-JSON string`);
	}
	return canonical;
}

function normalizeName(value: string | undefined, fallback: string): string {
	return boundedText(typeof value === "string" && value.length > 0 ? value : fallback, 128);
}

function boundedText(value: string, maxLength: number): string {
	let out = "";
	let length = 0;
	for (let index = 0; index < value.length && length < maxLength; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				out += value[index] ?? "";
				out += value[index + 1] ?? "";
				index += 1;
			} else {
				out += "\ufffd";
			}
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			out += "\ufffd";
		} else {
			out += value[index] ?? "";
		}
		length += 1;
	}
	return out;
}

function isBackendStatusState(value: unknown): value is CommittedFactJournalBackendStatusState {
	return (
		value === "available" || value === "degraded" || value === "unavailable" || value === "unknown"
	);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	try {
		const message = error instanceof Error ? error.message : String(error);
		return typeof message === "string" ? message : "error details were not safely reportable";
	} catch {
		return "error details were not safely reportable";
	}
}
