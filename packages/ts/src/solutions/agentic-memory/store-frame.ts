import { depLatest } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import { type Codec, cloneStrictJsonObject, strictJsonCodec } from "../../json/codec.js";
import type { Node } from "../../node/node.js";
import type { FactId } from "../../patterns/semantic-memory.js";
import {
	projectAgenticMemoryRecordApplicationEvidenceFacts,
	projectAgenticMemoryRecordApplicationPriorEvidence,
} from "./application-history.js";
import { agenticMemoryRecordCodec, agenticMemoryRecordFrame } from "./frame.js";
import { solutionProjection } from "./projection.js";
import { AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM } from "./record-application.js";
import {
	assertExactKeys,
	cloneStrictJsonObject as cloneAgenticStrictJsonObject,
	errorMessage,
	forbiddenAgenticMemoryDataFields,
	isNonEmptyString,
	isPlainRecord,
	snapshotAgenticMemoryFactRefs,
	strictJsonDataErrors,
	validateAgenticMemoryContextAttribution,
	validateAgenticMemoryFactRefs,
	validateAndProjectRecords,
} from "./shared.js";
import type {
	AgenticMemoryFactRef,
	AgenticMemoryRecord,
	AgenticMemoryRecordApplicationDecision,
	AgenticMemoryRecordApplicationEvidence,
	AgenticMemoryRecordApplicationOperation,
	AgenticMemoryRecordApplicationPriorEvidence,
	AgenticMemoryRecordFrame,
	StrictJsonValue,
} from "./types.js";

export const AGENTIC_MEMORY_RECORD_STORE_FRAME_FORMAT = "graphrefly.agenticMemoryRecordStoreFrame";
export const AGENTIC_MEMORY_APPLICATION_EVIDENCE_STORE_FRAME_FORMAT =
	"graphrefly.agenticMemoryApplicationEvidenceStoreFrame";
export const AGENTIC_MEMORY_APPLICATION_DECISION_STORE_FRAME_FORMAT =
	"graphrefly.agenticMemoryApplicationDecisionStoreFrame";
export const AGENTIC_MEMORY_STORE_FRAME_VERSION = 1;

export type AgenticMemoryRecordStoreFrameStatusState = "ready" | "empty" | "partial" | "error";

export interface AgenticMemoryRecordStoreFrameCursor {
	readonly evaluation: number;
	readonly frames: number;
	readonly decoded: number;
	readonly issues: number;
}

export interface AgenticMemoryRecordStoreFrameStatus {
	readonly state: AgenticMemoryRecordStoreFrameStatusState;
	readonly cursor: AgenticMemoryRecordStoreFrameCursor;
}

export interface AgenticMemoryRecordStoreFrameAudit {
	readonly kind: "agentic-memory-store-frame-audit";
	readonly action: "frame-decoded" | "issue-recorded";
	readonly reason?: string;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
}

export interface AgenticMemoryRecordStoreFrameProjection<T = unknown> {
	readonly kind: "agentic-memory-record-store-frame-projection";
	readonly records: readonly AgenticMemoryRecord<T>[];
	readonly status: AgenticMemoryRecordStoreFrameStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryRecordStoreFrameAudit[];
	readonly cursor: AgenticMemoryRecordStoreFrameCursor;
}

export interface AgenticMemoryRecordStoreFrameBundle<T = unknown> {
	readonly input: { readonly storeFrame: Node<AgenticMemoryRecordStoreFrame> };
	readonly projection: Node<AgenticMemoryRecordStoreFrameProjection<T>>;
	readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly status: Node<AgenticMemoryRecordStoreFrameStatus>;
	readonly issues: Node<readonly DataIssue[]>;
	readonly audit: Node<readonly AgenticMemoryRecordStoreFrameAudit[]>;
	readonly cursor: Node<AgenticMemoryRecordStoreFrameCursor>;
}

export interface AgenticMemoryRecordStoreFrameBundleOptions {
	readonly name?: string;
	readonly storeFrame: Node<AgenticMemoryRecordStoreFrame>;
}

export interface AgenticMemoryRecordStoreFrame<TJson extends StrictJsonValue = StrictJsonValue> {
	readonly format: typeof AGENTIC_MEMORY_RECORD_STORE_FRAME_FORMAT;
	readonly version: typeof AGENTIC_MEMORY_STORE_FRAME_VERSION;
	readonly kind: "agentic-memory-record-store-frame";
	readonly records: readonly AgenticMemoryRecordFrame<TJson>[];
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticMemoryApplicationEvidenceStoreFrame {
	readonly format: typeof AGENTIC_MEMORY_APPLICATION_EVIDENCE_STORE_FRAME_FORMAT;
	readonly version: typeof AGENTIC_MEMORY_STORE_FRAME_VERSION;
	readonly kind: "agentic-memory-application-evidence-store-frame";
	readonly priorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticMemoryApplicationDecisionStoreFrameDecision<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly kind: "agentic-memory-record-application-decision";
	readonly applicationId: FactId;
	readonly admissionId: FactId;
	readonly proposalId: FactId;
	readonly operation: AgenticMemoryRecordApplicationDecision["operation"];
	readonly operationVersion: 1;
	readonly state: AgenticMemoryRecordApplicationDecision["state"];
	readonly reasonCode: AgenticMemoryRecordApplicationDecision["reasonCode"];
	readonly reason?: string;
	readonly candidateMaterial: Omit<
		AgenticMemoryRecordApplicationDecision<StrictJsonValue>["candidateMaterial"],
		"record"
	> & { readonly record: AgenticMemoryRecordFrame<TJson> };
	readonly record?: AgenticMemoryRecordFrame<TJson>;
	readonly targetRecordId?: FactId;
	readonly idempotencyKey?: string;
	readonly materialIdentity?: AgenticMemoryRecordApplicationDecision["materialIdentity"];
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly evidenceRefs?: readonly AgenticMemoryFactRef[];
}

export interface AgenticMemoryApplicationDecisionStoreFrame<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly format: typeof AGENTIC_MEMORY_APPLICATION_DECISION_STORE_FRAME_FORMAT;
	readonly version: typeof AGENTIC_MEMORY_STORE_FRAME_VERSION;
	readonly kind: "agentic-memory-application-decision-store-frame";
	readonly applicationDecisions: readonly AgenticMemoryApplicationDecisionStoreFrameDecision<TJson>[];
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticMemoryApplicationEvidenceStoreFrameProjection {
	readonly kind: "agentic-memory-application-evidence-store-frame-projection";
	readonly priorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
	readonly evidenceFacts: readonly AgenticMemoryRecordApplicationEvidence[];
	readonly status: AgenticMemoryRecordStoreFrameStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryRecordStoreFrameAudit[];
	readonly cursor: AgenticMemoryRecordStoreFrameCursor;
}

export interface AgenticMemoryApplicationEvidenceStoreFrameBundle {
	readonly input: { readonly storeFrame: Node<AgenticMemoryApplicationEvidenceStoreFrame> };
	readonly projection: Node<AgenticMemoryApplicationEvidenceStoreFrameProjection>;
	readonly priorEvidence: Node<AgenticMemoryRecordApplicationPriorEvidence>;
	readonly evidenceFacts: Node<readonly AgenticMemoryRecordApplicationEvidence[]>;
	readonly status: Node<AgenticMemoryRecordStoreFrameStatus>;
	readonly issues: Node<readonly DataIssue[]>;
	readonly audit: Node<readonly AgenticMemoryRecordStoreFrameAudit[]>;
	readonly cursor: Node<AgenticMemoryRecordStoreFrameCursor>;
}

export interface AgenticMemoryApplicationEvidenceStoreFrameBundleOptions {
	readonly name?: string;
	readonly storeFrame: Node<AgenticMemoryApplicationEvidenceStoreFrame>;
}

/** Create a D585 passive strict-DATA store frame for AgenticMemoryRecord arrays.
 *
 * The frame is a versioned DTO only. It performs no storage I/O, hydration,
 * graph restore, commit acknowledgement, admission, or application decision.
 * @param records - AgenticMemory records to frame.
 * @param opts - Optional DATA provenance for the frame.
 * @returns A versioned strict-DATA record store frame.
 * @category solutions
 */
export function frameAgenticMemoryRecords<TJson extends StrictJsonValue>(
	records: readonly AgenticMemoryRecord<TJson>[],
	opts: StoreFrameOptions = {},
): AgenticMemoryRecordStoreFrame<TJson> {
	const projection = validateAndProjectRecords<TJson>(records);
	if (projection.errors.length > 0) {
		throw new TypeError(
			`agenticMemoryRecordStoreFrame: invalid records: ${projection.errors
				.flatMap((error) => error.validationErrors ?? [error.message])
				.join("; ")}`,
		);
	}
	return Object.freeze({
		format: AGENTIC_MEMORY_RECORD_STORE_FRAME_FORMAT,
		version: AGENTIC_MEMORY_STORE_FRAME_VERSION,
		kind: "agentic-memory-record-store-frame",
		records: Object.freeze(projection.records.map((record) => agenticMemoryRecordFrame(record))),
		...snapshotStoreFrameOptions(opts),
	});
}

/** Decode a D585 record store frame back into ordinary AgenticMemoryRecord DATA.
 * @param frame - Unknown frame DTO.
 * @returns Decoded records; callers decide how to feed them as ordinary DATA.
 * @category solutions
 */
export function decodeAgenticMemoryRecordStoreFrame<
	TJson extends StrictJsonValue = StrictJsonValue,
>(frame: unknown): readonly AgenticMemoryRecord<TJson>[] {
	const normalized = assertRecordStoreFrame<TJson>(frame);
	const codec = agenticMemoryRecordCodec<TJson>();
	return Object.freeze(
		normalized.records.map((recordFrame) => codec.decode(strictJsonCodec.encode(recordFrame))),
	);
}

/** Strict canonical JSON codec for D585 AgenticMemory record store frames.
 * @returns A strict frame codec.
 * @category solutions
 */
export function agenticMemoryRecordStoreFrameCodec<
	TJson extends StrictJsonValue = StrictJsonValue,
>(): Codec<AgenticMemoryRecordStoreFrame<TJson>> {
	return {
		encode(value) {
			return strictJsonCodec.encode(assertRecordStoreFrame<TJson>(value));
		},
		decode(bytes) {
			return assertRecordStoreFrame<TJson>(strictJsonCodec.decode(bytes));
		},
	};
}

/** Frame D584 application evidence/priorEvidence as passive strict DATA.
 * @param evidence - Evidence facts or a priorEvidence wrapper.
 * @param opts - Optional DATA provenance for the frame.
 * @returns A versioned application evidence store frame.
 * @category solutions
 */
export function frameAgenticMemoryApplicationEvidence(
	evidence:
		| readonly AgenticMemoryRecordApplicationEvidence[]
		| AgenticMemoryRecordApplicationPriorEvidence,
	opts: StoreFrameOptions = {},
): AgenticMemoryApplicationEvidenceStoreFrame {
	const projection = projectAgenticMemoryRecordApplicationPriorEvidence(evidence);
	if (projection.issues.length > 0) {
		throw new TypeError(
			`agenticMemoryApplicationEvidenceStoreFrame: invalid evidence: ${projection.issues
				.map((issue) => issue.message)
				.join("; ")}`,
		);
	}
	return Object.freeze({
		format: AGENTIC_MEMORY_APPLICATION_EVIDENCE_STORE_FRAME_FORMAT,
		version: AGENTIC_MEMORY_STORE_FRAME_VERSION,
		kind: "agentic-memory-application-evidence-store-frame",
		priorEvidence: projection.priorEvidence,
		...snapshotStoreFrameOptions(opts),
	});
}

/** Decode a D585 application evidence store frame.
 * @param frame - Unknown frame DTO.
 * @returns PriorEvidence DATA for later evaluations only.
 * @category solutions
 */
export function decodeAgenticMemoryApplicationEvidenceStoreFrame(
	frame: unknown,
): AgenticMemoryRecordApplicationPriorEvidence {
	const normalized = assertApplicationEvidenceStoreFrame(frame);
	const projection = projectAgenticMemoryRecordApplicationPriorEvidence(normalized.priorEvidence);
	if (projection.issues.length > 0) {
		throw new TypeError(
			`agenticMemoryApplicationEvidenceStoreFrame: invalid evidence: ${projection.issues
				.map((issue) => issue.message)
				.join("; ")}`,
		);
	}
	return projection.priorEvidence;
}

/** Strict canonical JSON codec for D585 application evidence store frames.
 * @returns A strict frame codec.
 * @category solutions
 */
export function agenticMemoryApplicationEvidenceStoreFrameCodec(): Codec<AgenticMemoryApplicationEvidenceStoreFrame> {
	return {
		encode(value) {
			return strictJsonCodec.encode(assertApplicationEvidenceStoreFrame(value));
		},
		decode(bytes) {
			return assertApplicationEvidenceStoreFrame(strictJsonCodec.decode(bytes));
		},
	};
}

/** Frame application decisions as passive strict DATA.
 *
 * Decisions are stored as DATA facts, not durable truth or commit
 * acknowledgements. Applied decision records are encoded through
 * AgenticMemoryRecordFrame so bigint timestamps remain strict JSON.
 * @param decisions - Application decisions to frame.
 * @param opts - Optional DATA provenance for the frame.
 * @returns A versioned decision store frame.
 * @category solutions
 */
export function frameAgenticMemoryApplicationDecisions<TJson extends StrictJsonValue>(
	decisions: readonly AgenticMemoryRecordApplicationDecision<TJson>[],
	opts: StoreFrameOptions = {},
): AgenticMemoryApplicationDecisionStoreFrame<TJson> {
	const evidenceProjection = projectAgenticMemoryRecordApplicationEvidenceFacts(decisions);
	const invalidAppliedIssues = evidenceProjection.issues.filter((issue) =>
		issue.code.includes("invalid-decision"),
	);
	if (invalidAppliedIssues.length > 0) {
		throw new TypeError(
			`agenticMemoryApplicationDecisionStoreFrame: invalid decisions: ${invalidAppliedIssues
				.map((issue) => issue.message)
				.join("; ")}`,
		);
	}
	return Object.freeze({
		format: AGENTIC_MEMORY_APPLICATION_DECISION_STORE_FRAME_FORMAT,
		version: AGENTIC_MEMORY_STORE_FRAME_VERSION,
		kind: "agentic-memory-application-decision-store-frame",
		applicationDecisions: Object.freeze(decisions.map((decision) => frameDecision(decision))),
		...snapshotStoreFrameOptions(opts),
	});
}

/** Decode a D585 application decision store frame.
 * @param frame - Unknown frame DTO.
 * @returns Application decision DATA facts.
 * @category solutions
 */
export function decodeAgenticMemoryApplicationDecisionStoreFrame<
	TJson extends StrictJsonValue = StrictJsonValue,
>(frame: unknown): readonly AgenticMemoryRecordApplicationDecision<TJson>[] {
	const normalized = assertApplicationDecisionStoreFrame<TJson>(frame);
	return Object.freeze(normalized.applicationDecisions.map((decision) => decodeDecision(decision)));
}

/** Strict canonical JSON codec for D585 application decision store frames.
 * @returns A strict frame codec.
 * @category solutions
 */
export function agenticMemoryApplicationDecisionStoreFrameCodec<
	TJson extends StrictJsonValue = StrictJsonValue,
>(): Codec<AgenticMemoryApplicationDecisionStoreFrame<TJson>> {
	return {
		encode(value) {
			return strictJsonCodec.encode(assertApplicationDecisionStoreFrame<TJson>(value));
		},
		decode(bytes) {
			return assertApplicationDecisionStoreFrame<TJson>(strictJsonCodec.decode(bytes));
		},
	};
}

/** Create a graph-visible D585 record store-frame decode bundle.
 *
 * Invalid frame DATA produces DATA issues/status, not protocol ERROR.
 * Decoded records re-enter later graphs only as ordinary records DATA.
 * @param graph - Graph that owns the nodes.
 * @param opts - Store-frame input node and optional name.
 * @returns Projection and read-model nodes.
 * @category solutions
 */
export function agenticMemoryRecordStoreFrameBundle<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	graph: Graph,
	opts: AgenticMemoryRecordStoreFrameBundleOptions,
): AgenticMemoryRecordStoreFrameBundle<TJson> {
	const name = opts.name ?? "agenticMemoryRecordStoreFrame";
	const projection = graph.node<AgenticMemoryRecordStoreFrameProjection<TJson>>(
		[opts.storeFrame],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			ctx.state.set(state);
			ctx.down([["DATA", projectRecordStoreFrame<TJson>(depLatest(ctx, 0), state.evaluation)]]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryRecordStoreFrame",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { storeFrame: opts.storeFrame },
		projection,
		records: solutionProjection(
			graph,
			projection,
			`${name}/records`,
			"agenticMemoryRecordStoreFrameRecords",
			(fact) => fact.records,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryRecordStoreFrameStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryRecordStoreFrameIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryRecordStoreFrameAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryRecordStoreFrameCursor",
			(fact) => fact.cursor,
		),
	};
}

/** Create a graph-visible D585 application evidence store-frame decode bundle.
 * @param graph - Graph that owns the nodes.
 * @param opts - Store-frame input node and optional name.
 * @returns Projection and read-model nodes.
 * @category solutions
 */
export function agenticMemoryApplicationEvidenceStoreFrameBundle(
	graph: Graph,
	opts: AgenticMemoryApplicationEvidenceStoreFrameBundleOptions,
): AgenticMemoryApplicationEvidenceStoreFrameBundle {
	const name = opts.name ?? "agenticMemoryApplicationEvidenceStoreFrame";
	const projection = graph.node<AgenticMemoryApplicationEvidenceStoreFrameProjection>(
		[opts.storeFrame],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			ctx.state.set(state);
			ctx.down([["DATA", projectEvidenceStoreFrame(depLatest(ctx, 0), state.evaluation)]]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryApplicationEvidenceStoreFrame",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { storeFrame: opts.storeFrame },
		projection,
		priorEvidence: solutionProjection(
			graph,
			projection,
			`${name}/priorEvidence`,
			"agenticMemoryApplicationEvidenceStoreFramePriorEvidence",
			(fact) => fact.priorEvidence,
		),
		evidenceFacts: solutionProjection(
			graph,
			projection,
			`${name}/evidenceFacts`,
			"agenticMemoryApplicationEvidenceStoreFrameEvidenceFacts",
			(fact) => fact.evidenceFacts,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryApplicationEvidenceStoreFrameStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryApplicationEvidenceStoreFrameIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryApplicationEvidenceStoreFrameAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryApplicationEvidenceStoreFrameCursor",
			(fact) => fact.cursor,
		),
	};
}

interface StoreFrameOptions {
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

function snapshotStoreFrameOptions(opts: StoreFrameOptions): StoreFrameOptions {
	const errors: string[] = [];
	const sourceRefs = snapshotOptionalRefs(opts.sourceRefs, "storeFrame.sourceRefs", errors);
	const policyRefs = snapshotOptionalRefs(opts.policyRefs, "storeFrame.policyRefs", errors);
	const metadata =
		opts.metadata === undefined ? undefined : cloneAgenticStrictJsonObject(opts.metadata);
	if (metadata !== undefined) {
		errors.push(...forbiddenStoreFrameMetadataFields(metadata, "storeFrame.metadata"));
	}
	if (errors.length > 0) {
		throw new TypeError(`agenticMemoryStoreFrame: invalid options: ${errors.join("; ")}`);
	}
	return {
		...(sourceRefs === undefined ? {} : { sourceRefs }),
		...(policyRefs === undefined ? {} : { policyRefs }),
		...(metadata === undefined ? {} : { metadata }),
	};
}

function snapshotOptionalRefs(
	value: readonly AgenticMemoryFactRef[] | undefined,
	label: string,
	errors: string[],
): readonly AgenticMemoryFactRef[] | undefined {
	if (value === undefined) return undefined;
	const validation = validateAgenticMemoryFactRefs(value);
	if (validation.length > 0) {
		errors.push(...validation.map((error) => `${label}: ${error}`));
		return undefined;
	}
	return snapshotAgenticMemoryFactRefs(value);
}

function assertRecordStoreFrame<TJson extends StrictJsonValue>(
	value: unknown,
): AgenticMemoryRecordStoreFrame<TJson> {
	const frame = cloneStrictJsonObject(
		value,
		"agenticMemoryRecordStoreFrame",
	) as unknown as AgenticMemoryRecordStoreFrame<TJson>;
	assertStoreFrameCommon(
		frame,
		AGENTIC_MEMORY_RECORD_STORE_FRAME_FORMAT,
		"agentic-memory-record-store-frame",
		"records",
	);
	if (!Array.isArray(frame.records)) {
		throw new TypeError("agenticMemoryRecordStoreFrame: records must be an array");
	}
	for (const recordFrame of frame.records) {
		agenticMemoryRecordCodec<TJson>().decode(strictJsonCodec.encode(recordFrame));
	}
	return Object.freeze({
		format: AGENTIC_MEMORY_RECORD_STORE_FRAME_FORMAT,
		version: AGENTIC_MEMORY_STORE_FRAME_VERSION,
		kind: "agentic-memory-record-store-frame",
		records: Object.freeze([...frame.records]),
		...snapshotStoreFrameOptions(frame),
	});
}

function assertApplicationEvidenceStoreFrame(
	value: unknown,
): AgenticMemoryApplicationEvidenceStoreFrame {
	const frame = cloneStrictJsonObject(
		value,
		"agenticMemoryApplicationEvidenceStoreFrame",
	) as unknown as AgenticMemoryApplicationEvidenceStoreFrame;
	assertStoreFrameCommon(
		frame,
		AGENTIC_MEMORY_APPLICATION_EVIDENCE_STORE_FRAME_FORMAT,
		"agentic-memory-application-evidence-store-frame",
		"priorEvidence",
	);
	const decoded = projectAgenticMemoryRecordApplicationPriorEvidence(frame.priorEvidence);
	if (decoded.issues.length > 0) {
		throw new TypeError(
			`agenticMemoryApplicationEvidenceStoreFrame: invalid priorEvidence: ${decoded.issues
				.map((issue) => issue.message)
				.join("; ")}`,
		);
	}
	return Object.freeze({
		format: AGENTIC_MEMORY_APPLICATION_EVIDENCE_STORE_FRAME_FORMAT,
		version: AGENTIC_MEMORY_STORE_FRAME_VERSION,
		kind: "agentic-memory-application-evidence-store-frame",
		priorEvidence: decoded.priorEvidence,
		...snapshotStoreFrameOptions(frame),
	});
}

function assertApplicationDecisionStoreFrame<TJson extends StrictJsonValue>(
	value: unknown,
): AgenticMemoryApplicationDecisionStoreFrame<TJson> {
	const frame = cloneStrictJsonObject(
		value,
		"agenticMemoryApplicationDecisionStoreFrame",
	) as unknown as AgenticMemoryApplicationDecisionStoreFrame<TJson>;
	assertStoreFrameCommon(
		frame,
		AGENTIC_MEMORY_APPLICATION_DECISION_STORE_FRAME_FORMAT,
		"agentic-memory-application-decision-store-frame",
		"applicationDecisions",
	);
	if (!Array.isArray(frame.applicationDecisions)) {
		throw new TypeError(
			"agenticMemoryApplicationDecisionStoreFrame: applicationDecisions must be an array",
		);
	}
	const decoded = frame.applicationDecisions.map((decision) => decodeDecision(decision));
	for (const decision of decoded) validateDecisionFrameDecision(decision);
	const evidenceProjection = projectAgenticMemoryRecordApplicationEvidenceFacts(decoded);
	if (evidenceProjection.issues.length > 0) {
		throw new TypeError(
			`agenticMemoryApplicationDecisionStoreFrame: invalid applicationDecisions: ${evidenceProjection.issues
				.map((issue) => issue.message)
				.join("; ")}`,
		);
	}
	return Object.freeze({
		format: AGENTIC_MEMORY_APPLICATION_DECISION_STORE_FRAME_FORMAT,
		version: AGENTIC_MEMORY_STORE_FRAME_VERSION,
		kind: "agentic-memory-application-decision-store-frame",
		applicationDecisions: Object.freeze([...frame.applicationDecisions]),
		...snapshotStoreFrameOptions(frame),
	});
}

function assertStoreFrameCommon(
	value: unknown,
	format: string,
	kind: string,
	payloadKey: string,
): void {
	if (!isPlainRecord(value))
		throw new TypeError("agenticMemoryStoreFrame: frame must be an object");
	assertExactKeys(
		value,
		[
			"format",
			"kind",
			"version",
			payloadKey,
			...(value.sourceRefs === undefined ? [] : ["sourceRefs"]),
			...(value.policyRefs === undefined ? [] : ["policyRefs"]),
			...(value.metadata === undefined ? [] : ["metadata"]),
		],
		"agenticMemoryStoreFrame",
	);
	if (value.format !== format) throw new TypeError("agenticMemoryStoreFrame: invalid format");
	if (value.version !== AGENTIC_MEMORY_STORE_FRAME_VERSION) {
		throw new TypeError("agenticMemoryStoreFrame: invalid version");
	}
	if (value.kind !== kind) throw new TypeError("agenticMemoryStoreFrame: invalid kind");
	for (const field of ["sourceRefs", "policyRefs"] as const) {
		if (value[field] !== undefined && validateAgenticMemoryFactRefs(value[field]).length > 0) {
			throw new TypeError(`agenticMemoryStoreFrame: invalid ${field}`);
		}
	}
	if (value.metadata !== undefined) {
		const metadataErrors = [
			...strictJsonDataErrors(value.metadata),
			...(isPlainRecord(value.metadata)
				? forbiddenStoreFrameMetadataFields(value.metadata, "metadata")
				: []),
		];
		if (metadataErrors.length > 0) {
			throw new TypeError("agenticMemoryStoreFrame: invalid metadata");
		}
	}
}

function projectRecordStoreFrame<TJson extends StrictJsonValue>(
	value: unknown,
	evaluation: number,
): AgenticMemoryRecordStoreFrameProjection<TJson> {
	try {
		const records = decodeAgenticMemoryRecordStoreFrame<TJson>(value);
		const cursor = cursorFor(evaluation, 1, records.length, 0);
		return Object.freeze({
			kind: "agentic-memory-record-store-frame-projection",
			records,
			status: statusFor(cursor),
			issues: Object.freeze([]),
			audit: Object.freeze([storeFrameAudit("frame-decoded")]),
			cursor,
		});
	} catch (error) {
		const issue = storeFrameIssue("agentic-memory.record-store-frame.invalid", error);
		const cursor = cursorFor(evaluation, 1, 0, 1);
		return Object.freeze({
			kind: "agentic-memory-record-store-frame-projection",
			records: Object.freeze([]),
			status: statusFor(cursor),
			issues: Object.freeze([issue]),
			audit: Object.freeze([storeFrameAudit("issue-recorded", issue.code)]),
			cursor,
		});
	}
}

function projectEvidenceStoreFrame(
	value: unknown,
	evaluation: number,
): AgenticMemoryApplicationEvidenceStoreFrameProjection {
	try {
		const priorEvidence = decodeAgenticMemoryApplicationEvidenceStoreFrame(value);
		const cursor = cursorFor(evaluation, 1, priorEvidence.entries.length, 0);
		return Object.freeze({
			kind: "agentic-memory-application-evidence-store-frame-projection",
			priorEvidence,
			evidenceFacts: priorEvidence.entries,
			status: statusFor(cursor),
			issues: Object.freeze([]),
			audit: Object.freeze([storeFrameAudit("frame-decoded")]),
			cursor,
		});
	} catch (error) {
		const issue = storeFrameIssue("agentic-memory.application-evidence-store-frame.invalid", error);
		const cursor = cursorFor(evaluation, 1, 0, 1);
		const priorEvidence: AgenticMemoryRecordApplicationPriorEvidence = Object.freeze({
			kind: "agentic-memory-record-application-prior-evidence",
			entries: Object.freeze([]),
		});
		return Object.freeze({
			kind: "agentic-memory-application-evidence-store-frame-projection",
			priorEvidence,
			evidenceFacts: Object.freeze([]),
			status: statusFor(cursor),
			issues: Object.freeze([issue]),
			audit: Object.freeze([storeFrameAudit("issue-recorded", issue.code)]),
			cursor,
		});
	}
}

function cursorFor(
	evaluation: number,
	frames: number,
	decoded: number,
	issues: number,
): AgenticMemoryRecordStoreFrameCursor {
	return Object.freeze({ evaluation, frames, decoded, issues });
}

function statusFor(
	cursor: AgenticMemoryRecordStoreFrameCursor,
): AgenticMemoryRecordStoreFrameStatus {
	return Object.freeze({
		state: cursor.issues > 0 ? "error" : cursor.decoded > 0 ? "ready" : "empty",
		cursor,
	});
}

function storeFrameIssue(code: string, error: unknown): DataIssue {
	return Object.freeze({
		kind: "issue",
		source: "agentic-memory",
		code,
		message: errorMessage(error),
		severity: "error",
	});
}

function storeFrameAudit(
	action: AgenticMemoryRecordStoreFrameAudit["action"],
	reason?: string,
): AgenticMemoryRecordStoreFrameAudit {
	return Object.freeze({
		kind: "agentic-memory-store-frame-audit",
		action,
		...(reason === undefined ? {} : { reason }),
	});
}

function frameDecision<TJson extends StrictJsonValue>(
	decision: AgenticMemoryRecordApplicationDecision<TJson>,
): AgenticMemoryApplicationDecisionStoreFrameDecision<TJson> {
	if (!isPlainRecord(decision.candidateMaterial)) {
		throw new TypeError(
			"agenticMemoryApplicationDecisionStoreFrame: candidateMaterial must be an object",
		);
	}
	const material = decision.candidateMaterial;
	const materialBase = cloneStrictJsonObject(
		{
			kind: material.kind,
			...(material.operation === undefined ? {} : { operation: material.operation }),
			...(material.operationVersion === undefined
				? {}
				: { operationVersion: material.operationVersion }),
			...(material.targetRecordId === undefined ? {} : { targetRecordId: material.targetRecordId }),
			...(material.attribution === undefined ? {} : { attribution: material.attribution }),
			...(material.sourceRefs === undefined ? {} : { sourceRefs: material.sourceRefs }),
			...(material.policyRefs === undefined ? {} : { policyRefs: material.policyRefs }),
			...(material.evidenceRefs === undefined ? {} : { evidenceRefs: material.evidenceRefs }),
			...(material.metadata === undefined ? {} : { metadata: material.metadata }),
		},
		"decision.candidateMaterial",
	) as unknown as Omit<
		AgenticMemoryApplicationDecisionStoreFrameDecision<TJson>["candidateMaterial"],
		"record"
	>;
	const framed = Object.freeze({
		kind: "agentic-memory-record-application-decision" as const,
		applicationId: assertNonEmpty(decision.applicationId, "decision.applicationId"),
		admissionId: assertNonEmpty(decision.admissionId, "decision.admissionId"),
		proposalId: assertNonEmpty(decision.proposalId, "decision.proposalId"),
		operation: decision.operation,
		operationVersion: 1 as const,
		state: decision.state,
		reasonCode: decision.reasonCode,
		...(decision.reason === undefined ? {} : { reason: decision.reason }),
		candidateMaterial: Object.freeze({
			...materialBase,
			record: agenticMemoryRecordFrame(material.record as AgenticMemoryRecord<TJson>),
		}),
		...(decision.record === undefined
			? {}
			: { record: agenticMemoryRecordFrame(decision.record as AgenticMemoryRecord<TJson>) }),
		...(decision.targetRecordId === undefined ? {} : { targetRecordId: decision.targetRecordId }),
		...(decision.idempotencyKey === undefined ? {} : { idempotencyKey: decision.idempotencyKey }),
		...(decision.materialIdentity === undefined
			? {}
			: { materialIdentity: decision.materialIdentity }),
		...(decision.sourceRefs === undefined
			? {}
			: { sourceRefs: snapshotAgenticMemoryFactRefs(decision.sourceRefs) }),
		...(decision.policyRefs === undefined
			? {}
			: { policyRefs: snapshotAgenticMemoryFactRefs(decision.policyRefs) }),
		...(decision.evidenceRefs === undefined
			? {}
			: { evidenceRefs: snapshotAgenticMemoryFactRefs(decision.evidenceRefs) }),
	});
	if (strictJsonDataErrors(framed, "applicationDecision").length > 0) {
		throw new TypeError("agenticMemoryApplicationDecisionStoreFrame: decision is not strict DATA");
	}
	return framed;
}

function decodeDecision<TJson extends StrictJsonValue>(
	decision: AgenticMemoryApplicationDecisionStoreFrameDecision<TJson>,
): AgenticMemoryRecordApplicationDecision<TJson> {
	const codec = agenticMemoryRecordCodec<TJson>();
	return Object.freeze({
		kind: "agentic-memory-record-application-decision",
		applicationId: assertNonEmpty(decision.applicationId, "decision.applicationId"),
		admissionId: assertNonEmpty(decision.admissionId, "decision.admissionId"),
		proposalId: assertNonEmpty(decision.proposalId, "decision.proposalId"),
		operation: decision.operation,
		operationVersion: 1,
		state: decision.state,
		reasonCode: decision.reasonCode,
		...(decision.reason === undefined ? {} : { reason: decision.reason }),
		candidateMaterial: Object.freeze({
			...decision.candidateMaterial,
			record: codec.decode(strictJsonCodec.encode(decision.candidateMaterial.record)),
		}),
		...(decision.record === undefined
			? {}
			: { record: codec.decode(strictJsonCodec.encode(decision.record)) }),
		...(decision.targetRecordId === undefined ? {} : { targetRecordId: decision.targetRecordId }),
		...(decision.idempotencyKey === undefined ? {} : { idempotencyKey: decision.idempotencyKey }),
		...(decision.materialIdentity === undefined
			? {}
			: { materialIdentity: decision.materialIdentity }),
		...(decision.sourceRefs === undefined ? {} : { sourceRefs: decision.sourceRefs }),
		...(decision.policyRefs === undefined ? {} : { policyRefs: decision.policyRefs }),
		...(decision.evidenceRefs === undefined ? {} : { evidenceRefs: decision.evidenceRefs }),
	});
}

function forbiddenStoreFrameMetadataFields(
	value: Record<string, unknown>,
	label: string,
): readonly string[] {
	const errors = [...forbiddenAgenticMemoryDataFields(value, label)];
	for (const field of [
		"persist",
		"persistence",
		"commit",
		"commitAck",
		"ack",
		"backend",
		"loader",
		"writer",
		"engine",
	] as const) {
		if (Object.hasOwn(value, field)) {
			errors.push(`${label}.${field} is not graph-visible DATA`);
		}
	}
	return errors;
}

function validateDecisionFrameDecision<TJson extends StrictJsonValue>(
	decision: AgenticMemoryRecordApplicationDecision<TJson>,
): void {
	const errors: string[] = [];
	const decisionRecord = decision as unknown as Record<string, unknown>;
	assertExactKeys(
		decisionRecord,
		[
			"kind",
			"applicationId",
			"admissionId",
			"proposalId",
			"operation",
			"operationVersion",
			"state",
			"reasonCode",
			"candidateMaterial",
			...(decision.reason === undefined ? [] : ["reason"]),
			...(decision.record === undefined ? [] : ["record"]),
			...(decision.targetRecordId === undefined ? [] : ["targetRecordId"]),
			...(decision.idempotencyKey === undefined ? [] : ["idempotencyKey"]),
			...(decision.materialIdentity === undefined ? [] : ["materialIdentity"]),
			...(decision.sourceRefs === undefined ? [] : ["sourceRefs"]),
			...(decision.policyRefs === undefined ? [] : ["policyRefs"]),
			...(decision.evidenceRefs === undefined ? [] : ["evidenceRefs"]),
		],
		"agenticMemoryApplicationDecisionStoreFrame.decision",
	);
	if (decision.kind !== "agentic-memory-record-application-decision") {
		errors.push("decision.kind must be agentic-memory-record-application-decision");
	}
	for (const field of ["applicationId", "admissionId", "proposalId", "reasonCode"] as const) {
		if (!isNonEmptyString(decision[field])) errors.push(`decision.${field} must be non-empty`);
	}
	if (!isApplicationOperation(decision.operation)) {
		errors.push("decision.operation must be create, replace, or update");
	}
	if (decision.operationVersion !== 1) errors.push("decision.operationVersion must be 1");
	if (
		decision.state !== "applied" &&
		decision.state !== "skipped" &&
		decision.state !== "rejected"
	) {
		errors.push("decision.state must be applied, skipped, or rejected");
	}
	for (const field of ["reason", "targetRecordId", "idempotencyKey"] as const) {
		if (decision[field] !== undefined && typeof decision[field] !== "string") {
			errors.push(`decision.${field} must be a string when present`);
		}
	}
	if (decision.targetRecordId !== undefined && !isNonEmptyString(decision.targetRecordId)) {
		errors.push("decision.targetRecordId must be non-empty when present");
	}
	if (
		decision.materialIdentity !== undefined &&
		!isValidMaterialIdentity(decision.materialIdentity)
	) {
		errors.push("decision.materialIdentity must be an application material identity");
	}
	for (const [field, refs] of [
		["sourceRefs", decision.sourceRefs],
		["policyRefs", decision.policyRefs],
		["evidenceRefs", decision.evidenceRefs],
	] as const) {
		if (refs !== undefined) {
			errors.push(
				...validateAgenticMemoryFactRefs(refs).map((error) => `decision.${field}: ${error}`),
			);
		}
	}
	validateDecisionFrameCandidateMaterial(decision.candidateMaterial, errors);
	if (decision.record !== undefined) {
		agenticMemoryRecordFrame(decision.record);
	}
	if (errors.length > 0) {
		throw new TypeError(
			`agenticMemoryApplicationDecisionStoreFrame: invalid decision: ${errors.join("; ")}`,
		);
	}
}

function validateDecisionFrameCandidateMaterial(
	value: unknown,
	errors: string[],
): asserts value is AgenticMemoryRecordApplicationDecision["candidateMaterial"] {
	if (!isPlainRecord(value)) {
		errors.push("decision.candidateMaterial must be an object");
		return;
	}
	assertExactKeys(
		value,
		[
			"kind",
			"record",
			...(value.operation === undefined ? [] : ["operation"]),
			...(value.operationVersion === undefined ? [] : ["operationVersion"]),
			...(value.targetRecordId === undefined ? [] : ["targetRecordId"]),
			...(value.attribution === undefined ? [] : ["attribution"]),
			...(value.sourceRefs === undefined ? [] : ["sourceRefs"]),
			...(value.policyRefs === undefined ? [] : ["policyRefs"]),
			...(value.evidenceRefs === undefined ? [] : ["evidenceRefs"]),
			...(value.metadata === undefined ? [] : ["metadata"]),
		],
		"agenticMemoryApplicationDecisionStoreFrame.candidateMaterial",
	);
	if (value.kind !== "agentic-memory-record-candidate-material") {
		errors.push("decision.candidateMaterial.kind must be agentic-memory-record-candidate-material");
	}
	if (value.operation !== undefined && !isApplicationOperation(value.operation)) {
		errors.push("decision.candidateMaterial.operation must be create, replace, or update");
	}
	if (value.operationVersion !== undefined && value.operationVersion !== 1) {
		errors.push("decision.candidateMaterial.operationVersion must be 1 when present");
	}
	if (value.targetRecordId !== undefined && !isNonEmptyString(value.targetRecordId)) {
		errors.push("decision.candidateMaterial.targetRecordId must be non-empty when present");
	}
	for (const [field, refs] of [
		["sourceRefs", value.sourceRefs],
		["policyRefs", value.policyRefs],
		["evidenceRefs", value.evidenceRefs],
	] as const) {
		if (refs !== undefined) {
			errors.push(
				...validateAgenticMemoryFactRefs(refs).map(
					(error) => `decision.candidateMaterial.${field}: ${error}`,
				),
			);
		}
	}
	if (value.metadata !== undefined) {
		const metadataErrors = [
			...strictJsonDataErrors(value.metadata),
			...(isPlainRecord(value.metadata)
				? forbiddenStoreFrameMetadataFields(value.metadata, "candidateMaterial.metadata")
				: []),
		];
		errors.push(...metadataErrors.map((error) => `decision.${error}`));
	}
	const attribution = validateAgenticMemoryContextAttribution(value.attribution);
	if (!attribution.ok) {
		errors.push(...attribution.errors.map((error) => `decision.candidateMaterial.${error}`));
	}
	try {
		agenticMemoryRecordFrame(value.record as AgenticMemoryRecord<StrictJsonValue>);
	} catch (error) {
		errors.push(`decision.candidateMaterial.record: ${errorMessage(error)}`);
	}
}

function isApplicationOperation(value: unknown): value is AgenticMemoryRecordApplicationOperation {
	return value === "create" || value === "replace" || value === "update";
}

function isValidMaterialIdentity(value: unknown): boolean {
	if (!isPlainRecord(value)) return false;
	try {
		assertExactKeys(value, ["algorithm", "key"], "decision.materialIdentity");
	} catch {
		return false;
	}
	return (
		value.algorithm === AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM &&
		isNonEmptyString(value.key)
	);
}

function assertNonEmpty(value: unknown, label: string): FactId {
	if (!isNonEmptyString(value)) throw new TypeError(`${label} must be non-empty`);
	return value as FactId;
}
