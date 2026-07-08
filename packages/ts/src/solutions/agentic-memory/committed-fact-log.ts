import type { DataIssue } from "../../data/index.js";
import {
	type Codec,
	cloneStrictJsonValue,
	strictCanonicalJsonBytes,
	strictJsonCodec,
} from "../../json/codec.js";
import type { FactId } from "../../patterns/semantic-memory.js";
import {
	projectAgenticMemoryRecordApplicationEvidenceFacts,
	projectAgenticMemoryRecordApplicationPriorEvidence,
} from "./application-history.js";
import {
	agenticMemoryRecordCodec,
	agenticMemoryRecordFrame,
	assertAgenticMemoryRecordFrame,
} from "./frame.js";
import {
	AGENTIC_MEMORY_APPLICATION_DECISION_STORE_FRAME_FORMAT,
	AGENTIC_MEMORY_STORE_FRAME_VERSION,
	type AgenticMemoryApplicationDecisionStoreFrame,
	type AgenticMemoryApplicationDecisionStoreFrameDecision,
	decodeAgenticMemoryApplicationDecisionStoreFrame,
} from "./store-frame.js";
import type {
	AgenticMemoryFactRef,
	AgenticMemoryRecord,
	AgenticMemoryRecordApplicationDecision,
	AgenticMemoryRecordApplicationEvidence,
	AgenticMemoryRecordApplicationPriorEvidence,
	AgenticMemoryRecordFrame,
	StrictJsonValue,
} from "./types.js";

export const AGENTIC_MEMORY_COMMITTED_FACT_FORMAT = "graphrefly.agenticMemoryCommittedFact";
export const AGENTIC_MEMORY_COMMITTED_FACT_BATCH_FORMAT =
	"graphrefly.agenticMemoryCommittedFactBatch";
export const AGENTIC_MEMORY_COMMITTED_FACT_SNAPSHOT_FORMAT =
	"graphrefly.agenticMemoryCommittedFactSnapshot";
export const AGENTIC_MEMORY_COMMITTED_FACT_VERSION = 1;
export const AGENTIC_MEMORY_COMMITTED_FACT_IDENTITY_ALGORITHM =
	"graphrefly.agenticMemoryCommittedFact.identity.v1";
export const AGENTIC_MEMORY_COMMITTED_FACT_MATERIAL_IDENTITY_ALGORITHM =
	"graphrefly.agenticMemoryCommittedFact.material.v1";
export const AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND = "agentic-memory-fact-stream.cursor";

export type AgenticMemoryCommittedFactFamily =
	| "record-material"
	| "application-decision"
	| "application-evidence"
	| "derived-prior-evidence";

export interface AgenticMemoryCommittedFactCursor {
	readonly kind: typeof AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND;
	/** D589 fact stream position only; never a graph clock, app version, or backend row id. */
	readonly position: number;
}

export interface AgenticMemoryCommittedFactCoordinates {
	readonly subjectId: FactId;
	readonly operation?: string;
	readonly operationVersion?: number;
	readonly scope?: readonly string[];
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface AgenticMemoryCommittedFactIdentity {
	readonly algorithm: typeof AGENTIC_MEMORY_COMMITTED_FACT_IDENTITY_ALGORITHM;
	readonly key: string;
}

export interface AgenticMemoryCommittedFactMaterialIdentity {
	readonly algorithm: typeof AGENTIC_MEMORY_COMMITTED_FACT_MATERIAL_IDENTITY_ALGORITHM;
	readonly key: string;
}

export interface AgenticMemoryCommittedRecordMaterial<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly kind: "agentic-memory-committed-record-material";
	readonly record: AgenticMemoryRecordFrame<TJson>;
	readonly operation?: "create" | "replace" | "update";
	readonly operationVersion?: 1;
	readonly targetRecordId?: FactId;
}

export interface AgenticMemoryCommittedApplicationDecisionMaterial<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly kind: "agentic-memory-committed-application-decision-material";
	readonly decision: AgenticMemoryApplicationDecisionStoreFrameDecision<TJson>;
}

export interface AgenticMemoryCommittedApplicationEvidenceMaterial {
	readonly kind: "agentic-memory-committed-application-evidence-material";
	readonly evidence: AgenticMemoryRecordApplicationEvidence;
}

export interface AgenticMemoryCommittedPriorEvidenceMaterial {
	readonly kind: "agentic-memory-committed-prior-evidence-material";
	readonly priorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
}

export type AgenticMemoryCommittedFactMaterial<TJson extends StrictJsonValue = StrictJsonValue> =
	| AgenticMemoryCommittedRecordMaterial<TJson>
	| AgenticMemoryCommittedApplicationDecisionMaterial<TJson>
	| AgenticMemoryCommittedApplicationEvidenceMaterial
	| AgenticMemoryCommittedPriorEvidenceMaterial;

export interface AgenticMemoryCommittedFact<TJson extends StrictJsonValue = StrictJsonValue> {
	readonly format: typeof AGENTIC_MEMORY_COMMITTED_FACT_FORMAT;
	readonly version: typeof AGENTIC_MEMORY_COMMITTED_FACT_VERSION;
	readonly kind: "agentic-memory-committed-fact";
	readonly family: AgenticMemoryCommittedFactFamily;
	readonly coordinates: AgenticMemoryCommittedFactCoordinates;
	readonly identity: AgenticMemoryCommittedFactIdentity;
	readonly materialIdentity: AgenticMemoryCommittedFactMaterialIdentity;
	readonly material: AgenticMemoryCommittedFactMaterial<TJson>;
}

export interface AgenticMemoryCommittedFactBatch<TJson extends StrictJsonValue = StrictJsonValue> {
	readonly format: typeof AGENTIC_MEMORY_COMMITTED_FACT_BATCH_FORMAT;
	readonly version: typeof AGENTIC_MEMORY_COMMITTED_FACT_VERSION;
	readonly kind: "agentic-memory-committed-fact-batch";
	readonly batchIdentity: AgenticMemoryCommittedFactMaterialIdentity;
	readonly facts: readonly AgenticMemoryCommittedFact<TJson>[];
}

export type AgenticMemoryFactCommitStatus =
	| "committed"
	| "duplicate"
	| "conflict"
	| "rejected"
	| "uncertain";

export interface AgenticMemoryFactLogAuditEntry {
	readonly kind: "agentic-memory-fact-log-audit";
	readonly action:
		| "batch-committed"
		| "batch-duplicate"
		| "batch-conflict"
		| "batch-rejected"
		| "batch-uncertain"
		| "facts-read"
		| "issue-recorded";
	readonly reason?: string;
	readonly factId?: string;
	readonly cursor?: AgenticMemoryCommittedFactCursor;
}

export interface AgenticMemoryFactCommitResult {
	readonly status: AgenticMemoryFactCommitStatus;
	readonly cursor: AgenticMemoryCommittedFactCursor;
	readonly facts: number;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryFactLogAuditEntry[];
}

export interface AgenticMemoryCommittedFactReadOptions {
	readonly after?: AgenticMemoryCommittedFactCursor;
	readonly limit?: number;
}

export interface AgenticMemoryCommittedFactReadResult<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly facts: readonly AgenticMemoryCommittedFact<TJson>[];
	readonly cursor: AgenticMemoryCommittedFactCursor;
	readonly done: boolean;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryFactLogAuditEntry[];
}

export interface AgenticMemoryCommittedFactLog<TJson extends StrictJsonValue = StrictJsonValue> {
	append(
		batch: AgenticMemoryCommittedFactBatch<TJson>,
	): AgenticMemoryFactCommitResult | PromiseLike<AgenticMemoryFactCommitResult>;
	read(
		opts?: AgenticMemoryCommittedFactReadOptions,
	):
		| AgenticMemoryCommittedFactReadResult<TJson>
		| PromiseLike<AgenticMemoryCommittedFactReadResult<TJson>>;
}

export interface AgenticMemoryCommittedFactMaterializationCursor {
	readonly facts: number;
	readonly recordMaterialFacts: number;
	readonly applicationDecisionFacts: number;
	readonly applicationEvidenceFacts: number;
	readonly priorEvidenceFacts: number;
	readonly invalidFacts: number;
	readonly issues: number;
}

export interface AgenticMemoryCommittedFactMaterializationStatus {
	readonly state: "ready" | "empty" | "partial" | "error";
	readonly cursor: AgenticMemoryCommittedFactMaterializationCursor;
}

export interface AgenticMemoryCommittedFactMaterializationAuditEntry {
	readonly kind: "agentic-memory-committed-fact-materialization-audit";
	readonly action:
		| "record-materialized"
		| "application-decision-evidence-projected"
		| "application-evidence-materialized"
		| "prior-evidence-materialized"
		| "issue-recorded";
	readonly factId?: string;
	readonly recordId?: FactId;
	readonly admissionId?: FactId;
	readonly reason?: string;
}

export interface AgenticMemoryCommittedFactMaterialization<T = unknown> {
	readonly kind: "agentic-memory-committed-fact-materialization";
	readonly records: readonly AgenticMemoryRecord<T>[];
	readonly priorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
	readonly status: AgenticMemoryCommittedFactMaterializationStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryCommittedFactMaterializationAuditEntry[];
	readonly cursor: AgenticMemoryCommittedFactMaterializationCursor;
}

export interface AgenticMemoryCommittedFactSnapshot<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly format: typeof AGENTIC_MEMORY_COMMITTED_FACT_SNAPSHOT_FORMAT;
	readonly version: typeof AGENTIC_MEMORY_COMMITTED_FACT_VERSION;
	readonly kind: "agentic-memory-committed-fact-snapshot";
	readonly coveredCursor: AgenticMemoryCommittedFactCursor;
	readonly records: readonly AgenticMemoryRecordFrame<TJson>[];
	readonly priorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
}

const textDecoder = new TextDecoder();

/** Derive the deterministic D589 fact identity from family and coordinates only.
 *
 * The committed fact identity is not a backend row id, graph clock, application
 * version, or storage handle. Reusing this identity with different material is
 * a fact-log conflict.
 * @param family - AgenticMemory committed fact family.
 * @param coordinates - Operation/source/correlation coordinates.
 * @returns A deterministic committed fact identity.
 * @category solutions
 */
export function agenticMemoryCommittedFactIdentity(
	family: AgenticMemoryCommittedFactFamily,
	coordinates: AgenticMemoryCommittedFactCoordinates,
): AgenticMemoryCommittedFactIdentity {
	validateFamily(family);
	const normalized = normalizeCoordinates(coordinates, "coordinates");
	return Object.freeze({
		algorithm: AGENTIC_MEMORY_COMMITTED_FACT_IDENTITY_ALGORITHM,
		key: strictJsonString({
			format: AGENTIC_MEMORY_COMMITTED_FACT_FORMAT,
			version: AGENTIC_MEMORY_COMMITTED_FACT_VERSION,
			family,
			coordinates: normalized,
		}),
	});
}

/** Derive deterministic D589 material identity from canonical strict fact material.
 * @param family - AgenticMemory committed fact family.
 * @param material - Canonical strict fact material.
 * @returns A deterministic material identity.
 * @category solutions
 */
export function agenticMemoryCommittedFactMaterialIdentity<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	family: AgenticMemoryCommittedFactFamily,
	material: AgenticMemoryCommittedFactMaterial<TJson>,
): AgenticMemoryCommittedFactMaterialIdentity {
	validateFamily(family);
	const normalized = cloneMaterial(material, "material");
	validateMaterialFamily(family, normalized.kind);
	return Object.freeze({
		algorithm: AGENTIC_MEMORY_COMMITTED_FACT_MATERIAL_IDENTITY_ALGORITHM,
		key: strictJsonString({
			format: AGENTIC_MEMORY_COMMITTED_FACT_FORMAT,
			version: AGENTIC_MEMORY_COMMITTED_FACT_VERSION,
			family,
			material: normalized,
		}),
	});
}

/** Build a canonical D589 committed fact DTO.
 *
 * This helper frames facts only. It does not persist storage, acknowledge an
 * application decision, hydrate a graph, mutate records, or grant replay
 * authority to a backend.
 * @param family - AgenticMemory committed fact family.
 * @param coordinates - Operation/source/correlation coordinates.
 * @param material - Canonical strict material for the fact.
 * @returns A canonical committed fact DTO.
 * @category solutions
 */
export function agenticMemoryCommittedFact<TJson extends StrictJsonValue = StrictJsonValue>(
	family: AgenticMemoryCommittedFactFamily,
	coordinates: AgenticMemoryCommittedFactCoordinates,
	material: AgenticMemoryCommittedFactMaterial<TJson>,
): AgenticMemoryCommittedFact<TJson> {
	validateFamily(family);
	const normalizedCoordinates = normalizeCoordinates(coordinates, "coordinates");
	const normalizedMaterial = cloneMaterial<TJson>(material, "material");
	validateMaterialFamily(family, normalizedMaterial.kind);
	return Object.freeze({
		format: AGENTIC_MEMORY_COMMITTED_FACT_FORMAT,
		version: AGENTIC_MEMORY_COMMITTED_FACT_VERSION,
		kind: "agentic-memory-committed-fact",
		family,
		coordinates: normalizedCoordinates,
		identity: agenticMemoryCommittedFactIdentity(family, normalizedCoordinates),
		materialIdentity: agenticMemoryCommittedFactMaterialIdentity(family, normalizedMaterial),
		material: normalizedMaterial,
	});
}

/** Build a canonical D589 record-material committed fact.
 * @param record - AgenticMemory record DATA to canonicalize as record material.
 * @param opts - Optional operation/source/correlation coordinates.
 * @returns A committed record-material fact.
 * @category solutions
 */
export function agenticMemoryCommittedRecordMaterialFact<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	record: AgenticMemoryRecord<TJson>,
	opts: {
		readonly operation?: "create" | "replace" | "update";
		readonly targetRecordId?: FactId;
		readonly sourceRefs?: readonly AgenticMemoryFactRef[];
		readonly correlationId?: string;
		readonly causationId?: string;
		readonly scope?: readonly string[];
	} = {},
): AgenticMemoryCommittedFact<TJson> {
	const material: AgenticMemoryCommittedRecordMaterial<TJson> = Object.freeze({
		kind: "agentic-memory-committed-record-material",
		record: agenticMemoryRecordFrame(record),
		...(opts.operation === undefined
			? {}
			: { operation: opts.operation, operationVersion: 1 as const }),
		...(opts.targetRecordId === undefined ? {} : { targetRecordId: opts.targetRecordId }),
	});
	return agenticMemoryCommittedFact(
		"record-material",
		{
			subjectId: record.id,
			...(opts.operation === undefined ? {} : { operation: opts.operation }),
			...(opts.operation === undefined ? {} : { operationVersion: 1 }),
			...(opts.scope === undefined ? {} : { scope: opts.scope }),
			...(opts.sourceRefs === undefined ? {} : { sourceRefs: opts.sourceRefs }),
			...(opts.correlationId === undefined ? {} : { correlationId: opts.correlationId }),
			...(opts.causationId === undefined ? {} : { causationId: opts.causationId }),
		},
		material,
	);
}

/** Build a canonical D589 application-decision committed fact.
 * @param decision - Graph-visible application decision DATA.
 * @param opts - Optional source/correlation coordinates.
 * @returns A committed application-decision fact.
 * @category solutions
 */
export function agenticMemoryCommittedApplicationDecisionFact<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	decision: AgenticMemoryRecordApplicationDecision<TJson>,
	opts: {
		readonly sourceRefs?: readonly AgenticMemoryFactRef[];
		readonly correlationId?: string;
		readonly causationId?: string;
		readonly scope?: readonly string[];
	} = {},
): AgenticMemoryCommittedFact<TJson> {
	const frame = frameSingleApplicationDecision(decision);
	return agenticMemoryCommittedFact(
		"application-decision",
		{
			subjectId: decision.applicationId,
			operation: decision.operation,
			operationVersion: decision.operationVersion,
			...(opts.scope === undefined ? {} : { scope: opts.scope }),
			...(opts.sourceRefs === undefined ? {} : { sourceRefs: opts.sourceRefs }),
			...(opts.correlationId === undefined ? {} : { correlationId: opts.correlationId }),
			causationId: opts.causationId ?? decision.proposalId,
		},
		Object.freeze({
			kind: "agentic-memory-committed-application-decision-material",
			decision: frame,
		}),
	);
}

/** Build a canonical D589 application-evidence committed fact.
 * @param evidence - Graph-visible application evidence DATA.
 * @param opts - Optional source/correlation coordinates.
 * @returns A committed application-evidence fact.
 * @category solutions
 */
export function agenticMemoryCommittedApplicationEvidenceFact(
	evidence: AgenticMemoryRecordApplicationEvidence,
	opts: {
		readonly sourceRefs?: readonly AgenticMemoryFactRef[];
		readonly correlationId?: string;
		readonly causationId?: string;
		readonly scope?: readonly string[];
	} = {},
): AgenticMemoryCommittedFact {
	const correlationId = opts.correlationId ?? evidence.idempotencyKey;
	const causationId = opts.causationId ?? evidence.proposalId;
	return agenticMemoryCommittedFact(
		"application-evidence",
		{
			subjectId: evidence.admissionId,
			operation: evidence.operation,
			operationVersion: evidence.operationVersion,
			...(opts.scope === undefined ? {} : { scope: opts.scope }),
			...(opts.sourceRefs === undefined ? {} : { sourceRefs: opts.sourceRefs }),
			...(correlationId === undefined ? {} : { correlationId }),
			...(causationId === undefined ? {} : { causationId }),
		},
		Object.freeze({
			kind: "agentic-memory-committed-application-evidence-material",
			evidence: cloneStrictJsonValue(
				evidence,
				"applicationEvidence",
			) as unknown as AgenticMemoryRecordApplicationEvidence,
		}),
	);
}

/** Build a canonical D589 derived prior-evidence/history committed fact.
 * @param priorEvidence - Derived prior-evidence DATA.
 * @param opts - Required subject plus optional source/correlation coordinates.
 * @returns A committed derived prior-evidence fact.
 * @category solutions
 */
export function agenticMemoryCommittedPriorEvidenceFact(
	priorEvidence: AgenticMemoryRecordApplicationPriorEvidence,
	opts: AgenticMemoryCommittedFactCoordinates,
): AgenticMemoryCommittedFact {
	return agenticMemoryCommittedFact(
		"derived-prior-evidence",
		opts,
		Object.freeze({
			kind: "agentic-memory-committed-prior-evidence-material",
			priorEvidence: cloneStrictJsonValue(
				priorEvidence,
				"priorEvidence",
			) as unknown as AgenticMemoryRecordApplicationPriorEvidence,
		}),
	);
}

/** Build a D589 canonical committed fact batch.
 * @param facts - Canonical committed facts to append as one visible-or-invisible unit.
 * @returns A canonical committed fact batch.
 * @category solutions
 */
export function agenticMemoryCommittedFactBatch<TJson extends StrictJsonValue = StrictJsonValue>(
	facts: readonly AgenticMemoryCommittedFact<TJson>[],
): AgenticMemoryCommittedFactBatch<TJson> {
	if (facts.length === 0) throw new TypeError("agenticMemoryCommittedFactBatch: facts is empty");
	const normalized: readonly AgenticMemoryCommittedFact<TJson>[] = Object.freeze(
		facts.map((fact) => assertAgenticMemoryCommittedFact<TJson>(fact)),
	);
	return Object.freeze({
		format: AGENTIC_MEMORY_COMMITTED_FACT_BATCH_FORMAT,
		version: AGENTIC_MEMORY_COMMITTED_FACT_VERSION,
		kind: "agentic-memory-committed-fact-batch",
		batchIdentity: Object.freeze({
			algorithm: AGENTIC_MEMORY_COMMITTED_FACT_MATERIAL_IDENTITY_ALGORITHM,
			key: strictJsonString({
				format: AGENTIC_MEMORY_COMMITTED_FACT_BATCH_FORMAT,
				version: AGENTIC_MEMORY_COMMITTED_FACT_VERSION,
				facts: normalized.map((fact) => ({
					identity: fact.identity,
					materialIdentity: fact.materialIdentity,
				})),
			}),
		}),
		facts: normalized,
	});
}

/** Assert and canonicalize a D589 committed fact DTO.
 * @param value - Unknown fact DTO.
 * @returns A canonical committed fact DTO.
 * @category solutions
 */
export function assertAgenticMemoryCommittedFact<TJson extends StrictJsonValue = StrictJsonValue>(
	value: unknown,
): AgenticMemoryCommittedFact<TJson> {
	const cloned = cloneStrictJsonValue(value, "agenticMemoryCommittedFact");
	if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
		throw new TypeError("agenticMemoryCommittedFact: fact must be an object");
	}
	const fact = cloned as unknown as AgenticMemoryCommittedFact<TJson>;
	if (fact.format !== AGENTIC_MEMORY_COMMITTED_FACT_FORMAT) {
		throw new TypeError("agenticMemoryCommittedFact: invalid format");
	}
	if (fact.version !== AGENTIC_MEMORY_COMMITTED_FACT_VERSION) {
		throw new TypeError("agenticMemoryCommittedFact: invalid version");
	}
	if (fact.kind !== "agentic-memory-committed-fact") {
		throw new TypeError("agenticMemoryCommittedFact: invalid kind");
	}
	validateFamily(fact.family);
	const coordinates = normalizeCoordinates(fact.coordinates, "coordinates");
	const material = cloneMaterial<TJson>(fact.material, "material");
	const canonical = agenticMemoryCommittedFact(fact.family, coordinates, material);
	if (
		canonical.identity.algorithm !== fact.identity?.algorithm ||
		canonical.identity.key !== fact.identity.key
	) {
		throw new TypeError("agenticMemoryCommittedFact: identity does not match canonical fact");
	}
	if (
		canonical.materialIdentity.algorithm !== fact.materialIdentity?.algorithm ||
		canonical.materialIdentity.key !== fact.materialIdentity.key
	) {
		throw new TypeError("agenticMemoryCommittedFact: materialIdentity does not match material");
	}
	return canonical;
}

/** Strict canonical JSON codec for D589 committed fact batches.
 * @returns A strict frame codec.
 * @category solutions
 */
export function agenticMemoryCommittedFactBatchCodec<
	TJson extends StrictJsonValue = StrictJsonValue,
>(): Codec<AgenticMemoryCommittedFactBatch<TJson>> {
	return {
		encode(value) {
			return strictJsonCodec.encode(assertAgenticMemoryCommittedFactBatch<TJson>(value));
		},
		decode(bytes) {
			return assertAgenticMemoryCommittedFactBatch<TJson>(strictJsonCodec.decode(bytes));
		},
	};
}

/** Assert and canonicalize a D589 committed fact batch.
 * @param value - Unknown batch DTO.
 * @returns A canonical committed fact batch.
 * @category solutions
 */
export function assertAgenticMemoryCommittedFactBatch<
	TJson extends StrictJsonValue = StrictJsonValue,
>(value: unknown): AgenticMemoryCommittedFactBatch<TJson> {
	const cloned = cloneStrictJsonValue(value, "agenticMemoryCommittedFactBatch");
	if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
		throw new TypeError("agenticMemoryCommittedFactBatch: batch must be an object");
	}
	const batch = cloned as unknown as AgenticMemoryCommittedFactBatch<TJson>;
	if (batch.format !== AGENTIC_MEMORY_COMMITTED_FACT_BATCH_FORMAT) {
		throw new TypeError("agenticMemoryCommittedFactBatch: invalid format");
	}
	if (batch.version !== AGENTIC_MEMORY_COMMITTED_FACT_VERSION) {
		throw new TypeError("agenticMemoryCommittedFactBatch: invalid version");
	}
	if (batch.kind !== "agentic-memory-committed-fact-batch") {
		throw new TypeError("agenticMemoryCommittedFactBatch: invalid kind");
	}
	if (!Array.isArray(batch.facts)) {
		throw new TypeError("agenticMemoryCommittedFactBatch: facts must be an array");
	}
	const canonical = agenticMemoryCommittedFactBatch<TJson>(batch.facts);
	if (
		canonical.batchIdentity.algorithm !== batch.batchIdentity?.algorithm ||
		canonical.batchIdentity.key !== batch.batchIdentity.key
	) {
		throw new TypeError("agenticMemoryCommittedFactBatch: batchIdentity mismatch");
	}
	return canonical;
}

/** Create an in-memory D589 reference fact-log adapter.
 *
 * This adapter is an executable reference for fact-log persistence semantics. It
 * supplies committed fact read results only; library materialization remains a
 * separate explicit DATA boundary. It does not provide production durability,
 * application acknowledgement, live graph truth, hot hydration, or record
 * mutation authority.
 * @returns A D589 committed fact-log reference adapter.
 * @category solutions
 */
export function memoryAgenticMemoryCommittedFactLog<
	TJson extends StrictJsonValue = StrictJsonValue,
>(): AgenticMemoryCommittedFactLog<TJson> {
	const facts: AgenticMemoryCommittedFact<TJson>[] = [];
	const byIdentity = new Map<string, AgenticMemoryCommittedFactMaterialIdentity>();

	function cursor(): AgenticMemoryCommittedFactCursor {
		return factCursor(facts.length);
	}

	return {
		append(batch) {
			let canonical: AgenticMemoryCommittedFactBatch<TJson>;
			try {
				canonical = assertAgenticMemoryCommittedFactBatch<TJson>(batch);
			} catch (error) {
				return commitResult("rejected", cursor(), 0, [
					issue(
						"agentic-memory.fact-log.batch-rejected",
						error instanceof Error ? error.message : String(error),
					),
				]);
			}
			const internal = internalIdentityConflicts(canonical.facts);
			if (internal !== undefined) {
				return commitResult(internal.status, cursor(), 0, [internal.issue]);
			}
			let existing = 0;
			for (const fact of canonical.facts) {
				const material = byIdentity.get(fact.identity.key);
				if (material === undefined) continue;
				if (material.key !== fact.materialIdentity.key) {
					return commitResult("conflict", cursor(), 0, [
						issue(
							"agentic-memory.fact-log.identity-conflict",
							"committed fact identity was reused with different material",
							{ subjectId: fact.identity.key },
						),
					]);
				}
				existing += 1;
			}
			if (existing === canonical.facts.length) {
				return commitResult("duplicate", cursor(), 0, []);
			}
			if (existing > 0) {
				return commitResult("rejected", cursor(), 0, [
					issue(
						"agentic-memory.fact-log.batch-overlaps-committed-log",
						"committed fact batch partially overlaps existing facts; retry by reading the stream cursor",
					),
				]);
			}
			for (const fact of canonical.facts) {
				facts.push(fact);
				byIdentity.set(fact.identity.key, fact.materialIdentity);
			}
			return commitResult("committed", cursor(), canonical.facts.length, []);
		},
		read(opts = {}) {
			const { after, limit } = validateReadOptions(opts);
			const visible = facts.slice(after, limit === Infinity ? undefined : after + limit);
			const next = factCursor(after + visible.length);
			return Object.freeze({
				facts: Object.freeze([...visible]),
				cursor: next,
				done: after + visible.length >= facts.length,
				issues: Object.freeze([]),
				audit: Object.freeze([
					audit("facts-read", { cursor: next, reason: `${visible.length} facts` }),
				]),
			});
		},
	};
}

/** True only for commit statuses that prove fact-log durability.
 * @param status - Commit result status.
 * @returns Whether the fact batch is known durable or idempotently already durable.
 * @category solutions
 */
export function agenticMemoryFactCommitStatusIsDurable(
	status: AgenticMemoryFactCommitStatus,
): boolean {
	return status === "committed" || status === "duplicate";
}

/** True only for commit statuses that prove the batch did not commit.
 * @param status - Commit result status.
 * @returns Whether the batch is known not to have committed.
 * @category solutions
 */
export function agenticMemoryFactCommitStatusIsTerminalFailure(
	status: AgenticMemoryFactCommitStatus,
): boolean {
	return status === "conflict" || status === "rejected";
}

/** Deterministically materialize AgenticMemory re-entry DATA from committed facts.
 *
 * The input order is the committed fact stream order supplied by an explicit
 * read/materialization boundary. This helper does not read storage, apply or
 * admit records, mutate live graph truth, refresh subscribers, or create a
 * graph commit barrier.
 *
 * @param facts - Committed facts in stream order.
 * @param opts - Optional prefix materialization seed used by snapshot+tail equivalence.
 * @returns Records/priorEvidence derived by library-owned materialization rules.
 * @category solutions
 */
export function materializeAgenticMemoryCommittedFacts<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	facts: readonly AgenticMemoryCommittedFact<TJson>[],
	opts: {
		readonly records?: readonly AgenticMemoryRecord<TJson>[];
		readonly priorEvidence?: AgenticMemoryRecordApplicationPriorEvidence;
	} = {},
): AgenticMemoryCommittedFactMaterialization<TJson> {
	const recordCodec = agenticMemoryRecordCodec<TJson>();
	const recordsById = new Map<FactId, AgenticMemoryRecord<TJson>>();
	for (const record of opts.records ?? []) recordsById.set(record.id, record);
	const evidence: AgenticMemoryRecordApplicationEvidence[] = [
		...(opts.priorEvidence?.entries ?? []),
	];
	const issues: DataIssue[] = [];
	const auditEntries: AgenticMemoryCommittedFactMaterializationAuditEntry[] = [];
	let invalidFacts = 0;
	let recordMaterialFacts = 0;
	let applicationDecisionFacts = 0;
	let applicationEvidenceFacts = 0;
	let priorEvidenceFacts = 0;

	for (let index = 0; index < facts.length; index += 1) {
		let fact: AgenticMemoryCommittedFact<TJson>;
		try {
			fact = assertAgenticMemoryCommittedFact<TJson>(facts[index]);
		} catch (error) {
			invalidFacts += 1;
			issues.push(
				issue(
					"agentic-memory.committed-fact-materialization.invalid-fact",
					error instanceof Error ? error.message : String(error),
					{ path: [index] },
				),
			);
			continue;
		}
		try {
			if (fact.material.kind === "agentic-memory-committed-record-material") {
				recordMaterialFacts += 1;
				const record = recordCodec.decode(strictJsonCodec.encode(fact.material.record));
				recordsById.set(record.id, record);
				auditEntries.push(
					materializationAudit("record-materialized", {
						factId: fact.identity.key,
						recordId: record.id,
					}),
				);
				continue;
			}
			if (fact.material.kind === "agentic-memory-committed-application-decision-material") {
				applicationDecisionFacts += 1;
				const decisions = decodeSingleApplicationDecision(fact.material.decision);
				const projected = projectAgenticMemoryRecordApplicationEvidenceFacts(decisions);
				evidence.push(...projected.priorEvidence.entries);
				auditEntries.push(
					materializationAudit("application-decision-evidence-projected", {
						factId: fact.identity.key,
						admissionId: decisions[0]?.admissionId,
					}),
				);
				continue;
			}
			if (fact.material.kind === "agentic-memory-committed-application-evidence-material") {
				applicationEvidenceFacts += 1;
				evidence.push(fact.material.evidence);
				auditEntries.push(
					materializationAudit("application-evidence-materialized", {
						factId: fact.identity.key,
						admissionId: fact.material.evidence.admissionId,
					}),
				);
				continue;
			}
			priorEvidenceFacts += 1;
			evidence.push(...fact.material.priorEvidence.entries);
			auditEntries.push(
				materializationAudit("prior-evidence-materialized", { factId: fact.identity.key }),
			);
		} catch (error) {
			invalidFacts += 1;
			issues.push(
				issue(
					"agentic-memory.committed-fact-materialization.failed",
					error instanceof Error ? error.message : String(error),
					{ path: [index], subjectId: fact.identity.key },
				),
			);
		}
	}

	const priorProjection = projectAgenticMemoryRecordApplicationPriorEvidence(evidence);
	issues.push(...priorProjection.issues);
	const cursor = materializationCursor({
		facts: facts.length,
		recordMaterialFacts,
		applicationDecisionFacts,
		applicationEvidenceFacts,
		priorEvidenceFacts,
		invalidFacts,
		issues: issues.length,
	});
	const records = Object.freeze([...recordsById.values()]);
	return Object.freeze({
		kind: "agentic-memory-committed-fact-materialization",
		records,
		priorEvidence: priorProjection.priorEvidence,
		status: Object.freeze({
			state:
				issues.length === 0
					? records.length === 0 && evidence.length === 0
						? "empty"
						: "ready"
					: "partial",
			cursor,
		}),
		issues: Object.freeze(issues),
		audit: Object.freeze([
			...auditEntries,
			...issues.map((item) =>
				materializationAudit("issue-recorded", { reason: item.code, factId: item.subjectId }),
			),
		]),
		cursor,
	});
}

/** Create a D589 compaction snapshot over a committed fact prefix.
 * @param facts - Committed prefix facts in stream order.
 * @returns Snapshot compaction artifact for that prefix.
 * @category solutions
 */
export function agenticMemoryCommittedFactSnapshot<TJson extends StrictJsonValue = StrictJsonValue>(
	facts: readonly AgenticMemoryCommittedFact<TJson>[],
): AgenticMemoryCommittedFactSnapshot<TJson> {
	const materialized = materializeAgenticMemoryCommittedFacts<TJson>(facts);
	return Object.freeze({
		format: AGENTIC_MEMORY_COMMITTED_FACT_SNAPSHOT_FORMAT,
		version: AGENTIC_MEMORY_COMMITTED_FACT_VERSION,
		kind: "agentic-memory-committed-fact-snapshot",
		coveredCursor: factCursor(facts.length),
		records: Object.freeze(materialized.records.map((record) => agenticMemoryRecordFrame(record))),
		priorEvidence: materialized.priorEvidence,
	});
}

/** Materialize a D589 compaction snapshot plus committed tail facts.
 *
 * Snapshot+tail materialization is an equivalence check over committed facts,
 * not backend-owned restore, hot hydration, or live graph mutation.
 *
 * @param snapshot - Prefix compaction artifact.
 * @param tail - Committed facts after the snapshot cursor.
 * @returns Materialization equivalent to the covered prefix plus tail facts.
 * @category solutions
 */
export function materializeAgenticMemoryCommittedFactSnapshotTail<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	snapshot: AgenticMemoryCommittedFactSnapshot<TJson>,
	tail: readonly AgenticMemoryCommittedFact<TJson>[],
): AgenticMemoryCommittedFactMaterialization<TJson> {
	const recordCodec = agenticMemoryRecordCodec<TJson>();
	const records = snapshot.records.map((frame) =>
		recordCodec.decode(strictJsonCodec.encode(frame)),
	);
	return materializeAgenticMemoryCommittedFacts(tail, {
		records,
		priorEvidence: snapshot.priorEvidence,
	});
}

/** Check D589 snapshot+tail equivalence for a committed prefix and tail.
 * @param prefix - Committed prefix facts.
 * @param tail - Committed tail facts.
 * @returns Whether snapshot+tail materializes identically to prefix plus tail facts.
 * @category solutions
 */
export function agenticMemoryCommittedFactSnapshotTailEquivalent<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	prefix: readonly AgenticMemoryCommittedFact<TJson>[],
	tail: readonly AgenticMemoryCommittedFact<TJson>[],
): boolean {
	const direct = materializationComparable(
		materializeAgenticMemoryCommittedFacts([...prefix, ...tail]),
	);
	const compacted = materializationComparable(
		materializeAgenticMemoryCommittedFactSnapshotTail(
			agenticMemoryCommittedFactSnapshot(prefix),
			tail,
		),
	);
	return strictJsonString(direct) === strictJsonString(compacted);
}

function strictJsonString(value: unknown): string {
	return textDecoder.decode(strictCanonicalJsonBytes(value));
}

function factCursor(position: number): AgenticMemoryCommittedFactCursor {
	if (!Number.isSafeInteger(position) || position < 0) {
		throw new RangeError("AgenticMemory fact cursor position must be a non-negative safe integer");
	}
	return Object.freeze({ kind: AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND, position });
}

function validateReadOptions(opts: AgenticMemoryCommittedFactReadOptions): {
	readonly after: number;
	readonly limit: number;
} {
	let after = 0;
	if (opts.after !== undefined) {
		const cloned = cloneStrictJsonValue(opts.after, "after");
		if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
			throw new TypeError("AgenticMemory committed fact read cursor must be an object");
		}
		const cursor = cloned as unknown as AgenticMemoryCommittedFactCursor;
		if (cursor.kind !== AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND) {
			throw new TypeError("AgenticMemory committed fact read cursor must be a fact-stream cursor");
		}
		after = cursor.position;
	}
	const limit = opts.limit ?? Number.POSITIVE_INFINITY;
	if (!Number.isSafeInteger(after) || after < 0) {
		throw new RangeError("AgenticMemory committed fact read cursor must be >= 0");
	}
	if (limit !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(limit) || limit < 0)) {
		throw new RangeError("AgenticMemory committed fact read limit must be >= 0 or Infinity");
	}
	return { after, limit };
}

function issue(
	code: string,
	message: string,
	fields: Omit<DataIssue, "kind" | "code" | "message" | "severity"> = {},
): DataIssue {
	return Object.freeze({ kind: "issue", code, message, severity: "error", ...fields });
}

function audit(
	action: AgenticMemoryFactLogAuditEntry["action"],
	fields: Omit<AgenticMemoryFactLogAuditEntry, "kind" | "action"> = {},
): AgenticMemoryFactLogAuditEntry {
	return Object.freeze({ kind: "agentic-memory-fact-log-audit", action, ...fields });
}

function commitResult(
	status: AgenticMemoryFactCommitStatus,
	cursor: AgenticMemoryCommittedFactCursor,
	facts: number,
	issues: readonly DataIssue[],
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
		cursor,
		facts,
		issues: Object.freeze([...issues]),
		audit: Object.freeze([
			audit(action, { cursor }),
			...issues.map((item) => audit("issue-recorded", { reason: item.code })),
		]),
	});
}

function internalIdentityConflicts(
	facts: readonly AgenticMemoryCommittedFact[],
): { readonly status: "conflict" | "rejected"; readonly issue: DataIssue } | undefined {
	const seen = new Map<string, string>();
	for (const fact of facts) {
		const existing = seen.get(fact.identity.key);
		if (existing === undefined) {
			seen.set(fact.identity.key, fact.materialIdentity.key);
			continue;
		}
		if (existing !== fact.materialIdentity.key) {
			return {
				status: "conflict",
				issue: issue(
					"agentic-memory.fact-log.batch-internal-conflict",
					"committed fact batch reuses one identity with different material",
					{ subjectId: fact.identity.key },
				),
			};
		}
		return {
			status: "rejected",
			issue: issue(
				"agentic-memory.fact-log.batch-duplicate-identity",
				"committed fact batch must not repeat the same fact identity",
				{ subjectId: fact.identity.key },
			),
		};
	}
	return undefined;
}

function normalizeCoordinates(
	value: AgenticMemoryCommittedFactCoordinates,
	label: string,
): AgenticMemoryCommittedFactCoordinates {
	const cloned = cloneStrictJsonValue(value, label);
	if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
		throw new TypeError(`${label}: coordinates must be an object`);
	}
	const coords = cloned as unknown as AgenticMemoryCommittedFactCoordinates;
	if (!isNonEmptyString(coords.subjectId)) {
		throw new TypeError(`${label}.subjectId must be a non-empty string`);
	}
	if (coords.operation !== undefined && !isNonEmptyString(coords.operation)) {
		throw new TypeError(`${label}.operation must be a non-empty string`);
	}
	if (
		coords.operationVersion !== undefined &&
		(!Number.isSafeInteger(coords.operationVersion) || coords.operationVersion < 0)
	) {
		throw new TypeError(`${label}.operationVersion must be a non-negative safe integer`);
	}
	if (
		coords.scope !== undefined &&
		(!Array.isArray(coords.scope) || !coords.scope.every(isNonEmptyString))
	) {
		throw new TypeError(`${label}.scope must contain only non-empty strings`);
	}
	if (coords.correlationId !== undefined && !isNonEmptyString(coords.correlationId)) {
		throw new TypeError(`${label}.correlationId must be a non-empty string`);
	}
	if (coords.causationId !== undefined && !isNonEmptyString(coords.causationId)) {
		throw new TypeError(`${label}.causationId must be a non-empty string`);
	}
	return Object.freeze({
		subjectId: coords.subjectId,
		...(coords.operation === undefined ? {} : { operation: coords.operation }),
		...(coords.operationVersion === undefined ? {} : { operationVersion: coords.operationVersion }),
		...(coords.scope === undefined ? {} : { scope: Object.freeze([...coords.scope]) }),
		...(coords.sourceRefs === undefined
			? {}
			: { sourceRefs: normalizeFactRefs(coords.sourceRefs, `${label}.sourceRefs`) }),
		...(coords.correlationId === undefined ? {} : { correlationId: coords.correlationId }),
		...(coords.causationId === undefined ? {} : { causationId: coords.causationId }),
	});
}

function normalizeFactRefs(
	refs: readonly AgenticMemoryFactRef[],
	label: string,
): readonly AgenticMemoryFactRef[] {
	if (!Array.isArray(refs)) throw new TypeError(`${label} must be an array`);
	return Object.freeze(
		refs.map((ref, index) => {
			const cloned = cloneStrictJsonValue(ref, `${label}[${index}]`);
			const item = cloned as unknown as AgenticMemoryFactRef;
			if (!isNonEmptyString(item.kind) || !isNonEmptyString(item.id)) {
				throw new TypeError(`${label}[${index}] must have non-empty kind and id`);
			}
			return Object.freeze(item);
		}),
	);
}

function cloneMaterial<TJson extends StrictJsonValue>(
	material: AgenticMemoryCommittedFactMaterial<TJson>,
	label: string,
): AgenticMemoryCommittedFactMaterial<TJson> {
	const cloned = cloneStrictJsonValue(material, label);
	const normalized = cloned as unknown as AgenticMemoryCommittedFactMaterial<TJson>;
	if (normalized.kind === "agentic-memory-committed-record-material") {
		assertAgenticMemoryRecordFrame(normalized.record);
		return Object.freeze(normalized);
	}
	if (normalized.kind === "agentic-memory-committed-application-decision-material") {
		decodeSingleApplicationDecision(normalized.decision);
		return Object.freeze(normalized);
	}
	if (normalized.kind === "agentic-memory-committed-application-evidence-material") {
		assertNoPriorEvidenceIssues(
			projectAgenticMemoryRecordApplicationPriorEvidence([normalized.evidence]),
			`${label}.evidence`,
		);
		return Object.freeze(normalized);
	}
	if (normalized.kind === "agentic-memory-committed-prior-evidence-material") {
		assertNoPriorEvidenceIssues(
			projectAgenticMemoryRecordApplicationPriorEvidence(normalized.priorEvidence),
			`${label}.priorEvidence`,
		);
		return Object.freeze(normalized);
	}
	throw new TypeError(
		`${label}.kind is not a supported AgenticMemory committed fact material kind`,
	);
}

function validateFamily(family: AgenticMemoryCommittedFactFamily): void {
	if (
		family !== "record-material" &&
		family !== "application-decision" &&
		family !== "application-evidence" &&
		family !== "derived-prior-evidence"
	) {
		throw new TypeError("agenticMemoryCommittedFact: invalid family");
	}
}

function validateMaterialFamily(
	family: AgenticMemoryCommittedFactFamily,
	materialKind: AgenticMemoryCommittedFactMaterial["kind"],
): void {
	const expected =
		family === "record-material"
			? "agentic-memory-committed-record-material"
			: family === "application-decision"
				? "agentic-memory-committed-application-decision-material"
				: family === "application-evidence"
					? "agentic-memory-committed-application-evidence-material"
					: "agentic-memory-committed-prior-evidence-material";
	if (materialKind !== expected) {
		throw new TypeError("agenticMemoryCommittedFact: material kind does not match family");
	}
}

function assertNoPriorEvidenceIssues(
	projection: ReturnType<typeof projectAgenticMemoryRecordApplicationPriorEvidence>,
	label: string,
): void {
	if (projection.issues.length === 0) return;
	throw new TypeError(
		`${label} is invalid: ${projection.issues.map((item) => item.code).join(", ")}`,
	);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function frameSingleApplicationDecision<TJson extends StrictJsonValue>(
	decision: AgenticMemoryRecordApplicationDecision<TJson>,
): AgenticMemoryApplicationDecisionStoreFrameDecision<TJson> {
	const frame: AgenticMemoryApplicationDecisionStoreFrame<TJson> = {
		format: AGENTIC_MEMORY_APPLICATION_DECISION_STORE_FRAME_FORMAT,
		version: AGENTIC_MEMORY_STORE_FRAME_VERSION,
		kind: "agentic-memory-application-decision-store-frame",
		applicationDecisions: [decisionToFrame(decision)],
	};
	const [decoded] = decodeAgenticMemoryApplicationDecisionStoreFrame<TJson>(frame);
	if (decoded === undefined) throw new TypeError("application decision did not decode");
	return frame.applicationDecisions[0]!;
}

function decisionToFrame<TJson extends StrictJsonValue>(
	decision: AgenticMemoryRecordApplicationDecision<TJson>,
): AgenticMemoryApplicationDecisionStoreFrameDecision<TJson> {
	return {
		kind: "agentic-memory-record-application-decision",
		applicationId: decision.applicationId,
		admissionId: decision.admissionId,
		proposalId: decision.proposalId,
		operation: decision.operation,
		operationVersion: decision.operationVersion,
		state: decision.state,
		reasonCode: decision.reasonCode,
		...(decision.reason === undefined ? {} : { reason: decision.reason }),
		candidateMaterial: {
			...decision.candidateMaterial,
			record: agenticMemoryRecordFrame(decision.candidateMaterial.record),
		},
		...(decision.record === undefined ? {} : { record: agenticMemoryRecordFrame(decision.record) }),
		...(decision.targetRecordId === undefined ? {} : { targetRecordId: decision.targetRecordId }),
		...(decision.idempotencyKey === undefined ? {} : { idempotencyKey: decision.idempotencyKey }),
		...(decision.materialIdentity === undefined
			? {}
			: { materialIdentity: decision.materialIdentity }),
		...(decision.sourceRefs === undefined ? {} : { sourceRefs: decision.sourceRefs }),
		...(decision.policyRefs === undefined ? {} : { policyRefs: decision.policyRefs }),
		...(decision.evidenceRefs === undefined ? {} : { evidenceRefs: decision.evidenceRefs }),
	};
}

function decodeSingleApplicationDecision<TJson extends StrictJsonValue>(
	decision: AgenticMemoryApplicationDecisionStoreFrameDecision<TJson>,
): readonly AgenticMemoryRecordApplicationDecision<TJson>[] {
	return decodeAgenticMemoryApplicationDecisionStoreFrame<TJson>({
		format: AGENTIC_MEMORY_APPLICATION_DECISION_STORE_FRAME_FORMAT,
		version: AGENTIC_MEMORY_STORE_FRAME_VERSION,
		kind: "agentic-memory-application-decision-store-frame",
		applicationDecisions: [decision],
	});
}

function materializationCursor(
	input: AgenticMemoryCommittedFactMaterializationCursor,
): AgenticMemoryCommittedFactMaterializationCursor {
	return Object.freeze(input);
}

function materializationAudit(
	action: AgenticMemoryCommittedFactMaterializationAuditEntry["action"],
	fields: Omit<AgenticMemoryCommittedFactMaterializationAuditEntry, "kind" | "action"> = {},
): AgenticMemoryCommittedFactMaterializationAuditEntry {
	return Object.freeze({
		kind: "agentic-memory-committed-fact-materialization-audit",
		action,
		...fields,
	});
}

function materializationComparable<TJson extends StrictJsonValue>(
	value: AgenticMemoryCommittedFactMaterialization<TJson>,
): {
	readonly records: readonly AgenticMemoryRecordFrame<TJson>[];
	readonly priorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
} {
	return {
		records: value.records.map((record) => agenticMemoryRecordFrame(record)),
		priorEvidence: value.priorEvidence,
	};
}
