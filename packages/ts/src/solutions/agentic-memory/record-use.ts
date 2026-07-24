import { depBatch, depLatest, depTerminal, isTerminalError } from "../../ctx/types.js";
import type { Graph } from "../../graph/graph.js";
import { canonicalTupleKey } from "../../identity.js";
import { strictCanonicalJsonBytes, strictJsonCodec } from "../../json/codec.js";
import {
	agenticMemoryRecordCodec,
	agenticMemoryRecordFrame,
	assertAgenticMemoryRecordFrame,
} from "./frame.js";
import { solutionProjection } from "./projection.js";
import {
	dataArrayContainerErrors,
	dataRecordContainerErrors,
	isNonEmptyString,
	isPlainRecord,
	safeArrayLength,
} from "./shared.js";
import type {
	AgenticMemoryRecord,
	AgenticMemoryRecordUseAuditEntry,
	AgenticMemoryRecordUseBoundedCollectionCursor,
	AgenticMemoryRecordUseCoordinate,
	AgenticMemoryRecordUseCursor,
	AgenticMemoryRecordUseDecision,
	AgenticMemoryRecordUseDecisionState,
	AgenticMemoryRecordUseExclusion,
	AgenticMemoryRecordUseGateBundle,
	AgenticMemoryRecordUseGateBundleOptions,
	AgenticMemoryRecordUseIssue,
	AgenticMemoryRecordUseReasonCode,
	AgenticMemoryRecordUseRecordIdentity,
	AgenticMemoryRecordUseRequest,
	AgenticMemoryRecordUseRequestIdentity,
	AgenticMemoryRecordUseRevisionCoordinate,
	AgenticMemoryRecordUseSnapshot,
	StrictJsonValue,
} from "./types.js";

/**
 * Strict D643 request format discriminator.
 * @category solutions
 */
export const AGENTIC_MEMORY_RECORD_USE_REQUEST_FORMAT =
	"graphrefly.agenticMemoryRecordUseRequest" as const;
/**
 * Strict D643 external-decision format discriminator.
 * @category solutions
 */
export const AGENTIC_MEMORY_RECORD_USE_DECISION_FORMAT =
	"graphrefly.agenticMemoryRecordUseDecision" as const;
/**
 * Immutable D643 snapshot format discriminator.
 * @category solutions
 */
export const AGENTIC_MEMORY_RECORD_USE_SNAPSHOT_FORMAT =
	"graphrefly.agenticMemoryRecordUseSnapshot" as const;
/**
 * Current D643 focused contract version.
 * @category solutions
 */
export const AGENTIC_MEMORY_RECORD_USE_VERSION = 1 as const;
/**
 * Synchronous strict-canonical request identity algorithm.
 * @category solutions
 */
export const AGENTIC_MEMORY_RECORD_USE_REQUEST_IDENTITY_ALGORITHM =
	"graphrefly.agenticMemoryRecordUseRequest.identity.v1" as const;
/**
 * Synchronous complete-record identity algorithm.
 * @category solutions
 */
export const AGENTIC_MEMORY_RECORD_USE_RECORD_IDENTITY_ALGORITHM =
	"graphrefly.agenticMemoryRecordUseRecord.identity.v1" as const;

/**
 * Fixed B113 v1 input and diagnostic bounds. Overflow is globally fail-closed.
 * @category solutions
 */
export const AGENTIC_MEMORY_RECORD_USE_V1_LIMITS = Object.freeze({
	records: 1024,
	decisions: 4096,
	coordinatesPerRequestField: 128,
	exclusions: 64,
	issues: 64,
	audit: 128,
});

const REQUEST_IDENTITY_FRAME_FORMAT =
	"graphrefly.agenticMemoryRecordUseRequestIdentityFrame" as const;
const RECORD_IDENTITY_FRAME_FORMAT =
	"graphrefly.agenticMemoryRecordUseRecordIdentityFrame" as const;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const REASON_ORDER = [
	"input-overflow",
	"invalid-input",
	"invalid-request",
	"invalid-record",
	"duplicate-record",
	"invalid-decision",
	"missing-decision",
	"request-mismatch",
	"stale-record",
	"orphan-decision",
	"duplicate-decision",
	"ambiguous-decision",
	"evaluation-invalid",
	"denied",
] as const satisfies readonly AgenticMemoryRecordUseReasonCode[];

const REASON_MESSAGE: Readonly<Record<AgenticMemoryRecordUseReasonCode, string>> = Object.freeze({
	"input-overflow": "record-use input exceeds a fixed v1 bound",
	"invalid-input": "record-use input could not be safely inspected",
	"invalid-request": "record-use request is not strict v1 data",
	"invalid-record": "current record is not strict canonical record data",
	"duplicate-record": "current record id is not unique",
	"invalid-decision": "record-use decision is not strict v1 data",
	"missing-decision": "current record has no exact matching decision",
	"request-mismatch": "decision does not match the current request",
	"stale-record": "decision does not match current record material",
	"orphan-decision": "decision does not name a current record",
	"duplicate-decision": "current record has duplicate decisions",
	"ambiguous-decision": "current record has conflicting decisions",
	"evaluation-invalid": "record use was withheld because the evaluation is invalid",
	denied: "external authority denied this record use",
});

interface CanonicalRecord<TJson extends StrictJsonValue> {
	readonly record: AgenticMemoryRecord<TJson>;
	readonly identity: AgenticMemoryRecordUseRecordIdentity;
	readonly inputIndex: number;
}

interface ValidDecision {
	readonly decision: AgenticMemoryRecordUseDecision;
	readonly inputIndex: number;
}

interface DecisionClaim {
	readonly requestKey: string;
	readonly recordId: string;
	readonly recordKey: string;
}

interface EvaluationDiagnostics {
	readonly exclusions: AgenticMemoryRecordUseExclusion[];
	readonly issues: AgenticMemoryRecordUseIssue[];
	readonly audit: AgenticMemoryRecordUseAuditEntry[];
	readonly reasonCounts: Record<AgenticMemoryRecordUseReasonCode, number>;
}

/**
 * Caller-selected metadata for creating one exact external D643 decision.
 * @category solutions
 */
export interface AgenticMemoryRecordUseDecisionOptions {
	readonly decisionId: string;
	readonly state: AgenticMemoryRecordUseDecisionState;
}

/**
 * Assert, normalize, sort, and deeply freeze one strict D643 request.
 *
 * Unknown fields and non-strict JSON values fail instead of being ignored.
 *
 * @param value - Unknown request-shaped DATA to validate.
 * @returns A normalized immutable v1 request.
 * @category solutions
 */
export function assertAgenticMemoryRecordUseRequest(value: unknown): AgenticMemoryRecordUseRequest {
	assertDataObject(value, "record-use request");
	assertExactFields(
		value,
		[
			"authorityCoordinates",
			"format",
			"policyCoordinates",
			"purpose",
			"requestId",
			"scope",
			"sourceRevisions",
			"subject",
			"version",
		],
		"record-use request",
	);
	if (value.format !== AGENTIC_MEMORY_RECORD_USE_REQUEST_FORMAT) {
		throw new TypeError("record-use request has an invalid format");
	}
	if (value.version !== AGENTIC_MEMORY_RECORD_USE_VERSION) {
		throw new TypeError("record-use request has an invalid version");
	}
	if (!isNonEmptyString(value.requestId)) {
		throw new TypeError("record-use requestId must be a non-empty string");
	}
	const request = Object.freeze({
		format: AGENTIC_MEMORY_RECORD_USE_REQUEST_FORMAT,
		version: AGENTIC_MEMORY_RECORD_USE_VERSION,
		requestId: value.requestId,
		subject: canonicalCoordinate(value.subject, "record-use request subject"),
		purpose: canonicalCoordinate(value.purpose, "record-use request purpose"),
		scope: canonicalCoordinate(value.scope, "record-use request scope"),
		sourceRevisions: canonicalRevisionCoordinates(
			value.sourceRevisions,
			"record-use request sourceRevisions",
		),
		policyCoordinates: canonicalRevisionCoordinates(
			value.policyCoordinates,
			"record-use request policyCoordinates",
		),
		authorityCoordinates: canonicalRevisionCoordinates(
			value.authorityCoordinates,
			"record-use request authorityCoordinates",
		),
	});
	strictCanonicalJsonBytes(request);
	return request;
}

/**
 * Return the synchronous strict-canonical identity of the complete D643 request frame.
 *
 * @param request - Strict request DATA to normalize and identify.
 * @returns A versioned request identity suitable for external decision creation.
 * @category solutions
 */
export function agenticMemoryRecordUseRequestIdentity(
	request: unknown,
): AgenticMemoryRecordUseRequestIdentity {
	const canonical = assertAgenticMemoryRecordUseRequest(request);
	return Object.freeze({
		version: AGENTIC_MEMORY_RECORD_USE_VERSION,
		algorithm: AGENTIC_MEMORY_RECORD_USE_REQUEST_IDENTITY_ALGORITHM,
		key: strictJsonText({
			format: REQUEST_IDENTITY_FRAME_FORMAT,
			version: AGENTIC_MEMORY_RECORD_USE_VERSION,
			request: canonical,
		}),
	});
}

/**
 * Return the synchronous strict-canonical identity of the complete canonical record frame.
 *
 * @param record - Current AgenticMemory record to identify.
 * @returns A versioned identity over the complete canonical record frame.
 * @category solutions
 */
export function agenticMemoryRecordUseRecordIdentity<
	TJson extends StrictJsonValue = StrictJsonValue,
>(record: AgenticMemoryRecord<TJson>): AgenticMemoryRecordUseRecordIdentity {
	return canonicalRecord(record, 0).identity;
}

/**
 * Create the D574 tuple coordinate used internally for exact-one decision cardinality.
 *
 * Callers pass ordinary request/record data and never hand-encode canonical identity material.
 *
 * @param request - Exact use request.
 * @param record - Exact current record.
 * @returns The D574 tuple key for request identity, record id, and record identity.
 * @category solutions
 */
export function agenticMemoryRecordUseDecisionCoordinate<
	TJson extends StrictJsonValue = StrictJsonValue,
>(request: AgenticMemoryRecordUseRequest, record: AgenticMemoryRecord<TJson>): string {
	const requestIdentity = agenticMemoryRecordUseRequestIdentity(request);
	const canonical = canonicalRecord(record, 0);
	return decisionCoordinate(requestIdentity.key, canonical.record.id, canonical.identity.key);
}

/**
 * Create one strict external decision pinned to an exact current request and record.
 *
 * @param request - Exact use request authorized or denied by the external authority.
 * @param record - Exact current record covered by the decision.
 * @param options - External decision id and allowed/denied state.
 * @returns An immutable strict v1 decision.
 * @category solutions
 */
export function createAgenticMemoryRecordUseDecision<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	request: AgenticMemoryRecordUseRequest,
	record: AgenticMemoryRecord<TJson>,
	options: AgenticMemoryRecordUseDecisionOptions,
): AgenticMemoryRecordUseDecision {
	if (!isNonEmptyString(options.decisionId)) {
		throw new TypeError("record-use decisionId must be a non-empty string");
	}
	if (options.state !== "allowed" && options.state !== "denied") {
		throw new TypeError("record-use decision state must be allowed or denied");
	}
	const canonical = canonicalRecord(record, 0);
	return Object.freeze({
		format: AGENTIC_MEMORY_RECORD_USE_DECISION_FORMAT,
		version: AGENTIC_MEMORY_RECORD_USE_VERSION,
		decisionId: options.decisionId,
		requestIdentity: agenticMemoryRecordUseRequestIdentity(request),
		recordId: canonical.record.id,
		recordIdentity: canonical.identity,
		state: options.state,
	});
}

/**
 * Assert and snapshot one strict v1 external decision.
 *
 * @param value - Unknown decision-shaped DATA to validate.
 * @returns A normalized immutable decision.
 * @category solutions
 */
export function assertAgenticMemoryRecordUseDecision(
	value: unknown,
): AgenticMemoryRecordUseDecision {
	assertDataObject(value, "record-use decision");
	assertExactFields(
		value,
		["decisionId", "format", "recordId", "recordIdentity", "requestIdentity", "state", "version"],
		"record-use decision",
	);
	if (value.format !== AGENTIC_MEMORY_RECORD_USE_DECISION_FORMAT) {
		throw new TypeError("record-use decision has an invalid format");
	}
	if (value.version !== AGENTIC_MEMORY_RECORD_USE_VERSION) {
		throw new TypeError("record-use decision has an invalid version");
	}
	if (!isNonEmptyString(value.decisionId)) {
		throw new TypeError("record-use decisionId must be a non-empty string");
	}
	if (!isNonEmptyString(value.recordId)) {
		throw new TypeError("record-use decision recordId must be a non-empty string");
	}
	if (value.state !== "allowed" && value.state !== "denied") {
		throw new TypeError("record-use decision state must be allowed or denied");
	}
	const requestIdentity = assertRequestIdentity(value.requestIdentity);
	const parsedRecordIdentity = assertRecordIdentity(value.recordIdentity);
	if (parsedRecordIdentity.recordId !== value.recordId) {
		throw new TypeError("record-use decision recordId does not match its record identity");
	}
	const decision = Object.freeze({
		format: AGENTIC_MEMORY_RECORD_USE_DECISION_FORMAT,
		version: AGENTIC_MEMORY_RECORD_USE_VERSION,
		decisionId: value.decisionId,
		requestIdentity,
		recordId: value.recordId,
		recordIdentity: parsedRecordIdentity.identity,
		state: value.state,
	});
	strictCanonicalJsonBytes(decision);
	return decision;
}

/**
 * Evaluate one exact D643 use synchronously.
 *
 * Structural faults are attributed to the affected coordinate and make the
 * exact-use evaluation globally fail-closed. A valid denial remains ready.
 *
 * @param recordsValue - Current AgenticMemory record array.
 * @param requestValue - One strict exact-use request.
 * @param decisionsValue - External decisions for the request and current records.
 * @param evaluation - Evaluation-local positive sequence value.
 * @returns One immutable fail-closed snapshot shared by declared projections.
 * @category solutions
 */
export function projectAgenticMemoryRecordUseGate<TJson extends StrictJsonValue = StrictJsonValue>(
	recordsValue: unknown,
	requestValue: unknown,
	decisionsValue: unknown,
	evaluation = 1,
): AgenticMemoryRecordUseSnapshot<TJson> {
	if (!Number.isSafeInteger(evaluation) || evaluation < 1) {
		throw new TypeError("record-use evaluation must be a safe integer >= 1");
	}
	const fallbackRecords = safeInputLength(recordsValue);
	const fallbackDecisions = safeInputLength(decisionsValue);
	try {
		return projectAgenticMemoryRecordUseGateInner<TJson>(
			recordsValue,
			requestValue,
			decisionsValue,
			evaluation,
		);
	} catch {
		return globalFailure<TJson>("invalid-input", evaluation, fallbackRecords, fallbackDecisions);
	}
}

function projectAgenticMemoryRecordUseGateInner<TJson extends StrictJsonValue = StrictJsonValue>(
	recordsValue: unknown,
	requestValue: unknown,
	decisionsValue: unknown,
	evaluation: number,
): AgenticMemoryRecordUseSnapshot<TJson> {
	const inputRecords = arrayLength(recordsValue);
	const inputDecisions = arrayLength(decisionsValue);
	if (inputRecords === undefined || inputDecisions === undefined) {
		return globalFailure<TJson>(
			"invalid-input",
			evaluation,
			inputRecords ?? 0,
			inputDecisions ?? 0,
		);
	}
	if (!Array.isArray(recordsValue)) {
		return globalFailure<TJson>("invalid-record", evaluation, inputRecords, inputDecisions);
	}
	if (!Array.isArray(decisionsValue)) {
		return globalFailure<TJson>("invalid-decision", evaluation, inputRecords, inputDecisions);
	}
	if (
		inputRecords > AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.records ||
		inputDecisions > AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.decisions
	) {
		return globalFailure<TJson>("input-overflow", evaluation, inputRecords, inputDecisions);
	}
	let request: AgenticMemoryRecordUseRequest;
	try {
		request = assertAgenticMemoryRecordUseRequest(requestValue);
	} catch {
		return globalFailure<TJson>("invalid-request", evaluation, inputRecords, inputDecisions);
	}
	const recordsContainerValid =
		dataArrayContainerErrors(recordsValue, "record-use records", inputRecords).length === 0;
	const decisionsContainerValid =
		dataArrayContainerErrors(decisionsValue, "record-use decisions", inputDecisions).length === 0;
	if (!recordsContainerValid || !decisionsContainerValid) {
		return globalFailure<TJson>(
			!recordsContainerValid ? "invalid-record" : "invalid-decision",
			evaluation,
			inputRecords,
			inputDecisions,
		);
	}

	const diagnostics = emptyDiagnostics();
	const canonicalRecords: CanonicalRecord<TJson>[] = [];
	let invalidRecords = 0;
	for (let index = 0; index < inputRecords; index += 1) {
		if (!Object.hasOwn(recordsValue, index)) {
			invalidRecords += 1;
			addRecordFault(diagnostics, "invalid-record");
			continue;
		}
		const raw = recordsValue[index];
		try {
			canonicalRecords.push(canonicalRecord(raw as AgenticMemoryRecord<TJson>, index));
		} catch {
			invalidRecords += 1;
			addRecordFault(diagnostics, "invalid-record");
		}
	}
	canonicalRecords.sort(compareCanonicalRecords);

	const duplicateRecordIds = new Set<string>();
	const recordsById = new Map<string, CanonicalRecord<TJson>[]>();
	for (const current of canonicalRecords) {
		const group = recordsById.get(current.record.id);
		if (group === undefined) recordsById.set(current.record.id, [current]);
		else {
			group.push(current);
			duplicateRecordIds.add(current.record.id);
		}
	}
	for (const recordId of [...duplicateRecordIds].sort()) {
		const group = recordsById.get(recordId) ?? [];
		for (const _current of group) {
			addExclusion(diagnostics, "duplicate-record");
			addAudit(diagnostics, {
				action: "excluded",
				reason: "duplicate-record",
			});
		}
		addIssue(diagnostics, "duplicate-record");
	}

	const requestIdentity = agenticMemoryRecordUseRequestIdentity(request);
	const validDecisions: ValidDecision[] = [];
	const invalidClaims = new Map<string, DecisionClaim[]>();
	let invalidDecisions = 0;
	for (let index = 0; index < inputDecisions; index += 1) {
		if (!Object.hasOwn(decisionsValue, index)) {
			invalidDecisions += 1;
			addDecisionFault(diagnostics, "invalid-decision");
			continue;
		}
		const raw = decisionsValue[index];
		const claim = decisionClaim(raw);
		try {
			validDecisions.push({
				decision: assertAgenticMemoryRecordUseDecision(raw),
				inputIndex: index,
			});
		} catch {
			invalidDecisions += 1;
			addDecisionFault(diagnostics, "invalid-decision");
			if (claim !== undefined) {
				const coordinate = decisionCoordinate(claim.requestKey, claim.recordId, claim.recordKey);
				const claims = invalidClaims.get(coordinate);
				if (claims === undefined) invalidClaims.set(coordinate, [claim]);
				else claims.push(claim);
			}
		}
	}
	validDecisions.sort(compareValidDecisions);

	const exact = new Map<string, ValidDecision[]>();
	const anomalyByRecordId = new Map<string, Set<AgenticMemoryRecordUseReasonCode>>();
	for (const current of validDecisions) {
		const decision = current.decision;
		const recordGroup = recordsById.get(decision.recordId);
		if (recordGroup === undefined) {
			addExclusion(diagnostics, "orphan-decision");
			addIssue(diagnostics, "orphan-decision");
			addAudit(diagnostics, {
				action: "excluded",
				reason: "orphan-decision",
			});
			continue;
		}
		if (decision.requestIdentity.key !== requestIdentity.key) {
			addRecordAnomaly(anomalyByRecordId, decision.recordId, "request-mismatch");
			continue;
		}
		const matchingMaterial = recordGroup.some(
			(record) => record.identity.key === decision.recordIdentity.key,
		);
		if (!matchingMaterial) {
			addRecordAnomaly(anomalyByRecordId, decision.recordId, "stale-record");
			continue;
		}
		const coordinate = decisionCoordinate(
			decision.requestIdentity.key,
			decision.recordId,
			decision.recordIdentity.key,
		);
		const matches = exact.get(coordinate);
		if (matches === undefined) exact.set(coordinate, [current]);
		else matches.push(current);
	}

	const allowedRecords: AgenticMemoryRecord<TJson>[] = [];
	let deniedRecords = 0;
	let excludedRecords = invalidRecords;
	for (const current of canonicalRecords) {
		if (duplicateRecordIds.has(current.record.id)) {
			excludedRecords += 1;
			continue;
		}
		const coordinate = decisionCoordinate(
			requestIdentity.key,
			current.record.id,
			current.identity.key,
		);
		const matches = exact.get(coordinate) ?? [];
		const malformedClaimCount = invalidClaims.get(coordinate)?.length ?? 0;
		if (malformedClaimCount > 0) {
			excludedRecords += 1;
			addExclusion(diagnostics, "invalid-decision");
			addAudit(diagnostics, {
				action: "excluded",
				reason: "invalid-decision",
			});
			continue;
		}
		const anomalies = anomalyByRecordId.get(current.record.id);
		if (anomalies !== undefined && anomalies.size > 0) {
			excludedRecords += 1;
			const reason = anomalies.has("request-mismatch") ? "request-mismatch" : "stale-record";
			addExclusion(diagnostics, reason);
			addIssue(diagnostics, reason);
			addAudit(diagnostics, {
				action: "excluded",
				reason,
			});
			continue;
		}
		if (matches.length > 1) {
			excludedRecords += 1;
			const states = new Set(matches.map((match) => match.decision.state));
			const reason = states.size > 1 ? "ambiguous-decision" : "duplicate-decision";
			addExclusion(diagnostics, reason);
			addIssue(diagnostics, reason);
			addAudit(diagnostics, {
				action: "excluded",
				reason,
			});
			continue;
		}
		const match = matches[0];
		if (match === undefined) {
			excludedRecords += 1;
			const reason = "missing-decision";
			addExclusion(diagnostics, reason);
			addIssue(diagnostics, reason);
			addAudit(diagnostics, {
				action: "excluded",
				reason,
			});
			continue;
		}
		if (match.decision.state === "denied") {
			deniedRecords += 1;
			excludedRecords += 1;
			addExclusion(diagnostics, "denied");
			addAudit(diagnostics, {
				action: "denied",
				reason: "denied",
			});
			continue;
		}
		allowedRecords.push(current.record);
		addAudit(diagnostics, {
			action: "allowed",
		});
	}

	if (diagnostics.issues.length > 0 && allowedRecords.length > 0) {
		for (const _record of allowedRecords) {
			excludedRecords += 1;
			addExclusion(diagnostics, "evaluation-invalid");
			addAudit(diagnostics, {
				action: "excluded",
				reason: "evaluation-invalid",
			});
		}
		for (let index = diagnostics.audit.length - 1; index >= 0; index -= 1) {
			const entry = diagnostics.audit[index];
			if (entry?.action === "allowed") {
				diagnostics.audit.splice(index, 1);
			}
		}
		allowedRecords.length = 0;
	}
	allowedRecords.sort((left, right) => compareText(left.id, right.id));
	return finishSnapshot<TJson>({
		evaluation,
		inputRecords,
		validRecords: canonicalRecords.length,
		invalidRecords,
		inputDecisions,
		validDecisions: validDecisions.length,
		invalidDecisions,
		allowedRecords,
		deniedRecords,
		excludedRecords,
		diagnostics,
	});
}

/**
 * Create the static graph-visible single-use gate bundle locked by D643.
 *
 * Governed retrieval must consume only this bundle's `allowedRecords` projection.
 *
 * @param graph - Graph that owns the gate and projection nodes.
 * @param opts - Declared record, request, and external-decision dependencies.
 * @returns One snapshot node plus allowedRecords/exclusions/status/issues/audit/cursor projections.
 * @category solutions
 */
export function agenticMemoryRecordUseGateBundle<TJson extends StrictJsonValue = StrictJsonValue>(
	graph: Graph,
	opts: AgenticMemoryRecordUseGateBundleOptions<TJson>,
): AgenticMemoryRecordUseGateBundle<TJson> {
	const name = opts.name ?? "agenticMemoryRecordUseGate";
	const snapshot = graph.node<AgenticMemoryRecordUseSnapshot<TJson>>(
		[opts.records, opts.request, opts.decisions],
		(ctx) => {
			const records = depLatest(ctx, 0);
			const request = depLatest(ctx, 1);
			const decisions = depLatest(ctx, 2);
			const state =
				ctx.state.get<{ dependencyFailed: boolean; evaluation: number }>() ??
				({
					dependencyFailed: false,
					evaluation: 0,
				} satisfies { dependencyFailed: boolean; evaluation: number });
			if ([0, 1, 2].some((index) => isTerminalError(depTerminal(ctx, index)))) {
				state.dependencyFailed = true;
			}
			if (
				!state.dependencyFailed &&
				[0, 1, 2].every((index) => (depBatch(ctx, index)?.length ?? 0) === 0)
			) {
				return;
			}
			state.evaluation += 1;
			ctx.state.set(state);
			if (state.dependencyFailed) {
				ctx.down([
					[
						"DATA",
						globalFailure<TJson>(
							"invalid-input",
							state.evaluation,
							safeInputLength(records),
							safeInputLength(decisions),
						),
					],
				]);
				return;
			}
			if (records === undefined || request === undefined || decisions === undefined) return;
			ctx.down([
				[
					"DATA",
					projectAgenticMemoryRecordUseGate<TJson>(records, request, decisions, state.evaluation),
				],
			]);
		},
		{
			name: `${name}/snapshot`,
			factory: "agenticMemoryRecordUseGate",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			terminalAsRealInput: true,
		},
	);
	return {
		input: {
			records: opts.records,
			request: opts.request,
			decisions: opts.decisions,
		},
		snapshot,
		allowedRecords: solutionProjection(
			graph,
			snapshot,
			`${name}/allowedRecords`,
			"agenticMemoryRecordUseAllowedRecords",
			(fact) => fact.allowedRecords,
		),
		exclusions: solutionProjection(
			graph,
			snapshot,
			`${name}/exclusions`,
			"agenticMemoryRecordUseExclusions",
			(fact) => fact.exclusions,
		),
		status: solutionProjection(
			graph,
			snapshot,
			`${name}/status`,
			"agenticMemoryRecordUseStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			snapshot,
			`${name}/issues`,
			"agenticMemoryRecordUseIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			snapshot,
			`${name}/audit`,
			"agenticMemoryRecordUseAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			snapshot,
			`${name}/cursor`,
			"agenticMemoryRecordUseCursor",
			(fact) => fact.cursor,
		),
	};
}

function canonicalCoordinate(value: unknown, label: string): AgenticMemoryRecordUseCoordinate {
	assertDataObject(value, label);
	assertExactFields(value, ["id", "kind"], label);
	if (!isNonEmptyString(value.kind) || !isNonEmptyString(value.id)) {
		throw new TypeError(`${label} kind and id must be non-empty strings`);
	}
	return Object.freeze({ kind: value.kind, id: value.id });
}

function canonicalRevisionCoordinates(
	value: unknown,
	label: string,
): readonly AgenticMemoryRecordUseRevisionCoordinate[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	const length = observedArrayLength(value);
	if (length === undefined) throw new TypeError(`${label} length is not canonical`);
	if (
		length > AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.coordinatesPerRequestField ||
		dataArrayContainerErrors(value, label, length).length > 0
	) {
		throw new TypeError(`${label} is not a bounded dense data array`);
	}
	const coordinates: AgenticMemoryRecordUseRevisionCoordinate[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < length; index += 1) {
		if (!Object.hasOwn(value, index)) throw new TypeError(`${label} must be dense`);
		const raw = value[index];
		assertDataObject(raw, `${label} entry`);
		assertExactFields(raw, ["id", "kind", "revision"], `${label} entry`);
		if (
			!isNonEmptyString(raw.kind) ||
			!isNonEmptyString(raw.id) ||
			!isNonEmptyString(raw.revision)
		) {
			throw new TypeError(`${label} entry fields must be non-empty strings`);
		}
		const coordinate = Object.freeze({
			kind: raw.kind,
			id: raw.id,
			revision: raw.revision,
		});
		const key = canonicalTupleKey([coordinate.kind, coordinate.id, coordinate.revision]);
		if (seen.has(key)) throw new TypeError(`${label} contains a duplicate coordinate`);
		seen.add(key);
		coordinates.push(coordinate);
	}
	coordinates.sort((left, right) =>
		compareText(
			canonicalTupleKey([left.kind, left.id, left.revision]),
			canonicalTupleKey([right.kind, right.id, right.revision]),
		),
	);
	return Object.freeze(coordinates);
}

function canonicalRecord<TJson extends StrictJsonValue>(
	value: AgenticMemoryRecord<TJson>,
	inputIndex: number,
): CanonicalRecord<TJson> {
	assertRecordUseRecordDataContainers(value);
	const codec = agenticMemoryRecordCodec<TJson>();
	const record = codec.decode(codec.encode(value));
	const frame = agenticMemoryRecordFrame(record);
	const identity = Object.freeze({
		version: AGENTIC_MEMORY_RECORD_USE_VERSION,
		algorithm: AGENTIC_MEMORY_RECORD_USE_RECORD_IDENTITY_ALGORITHM,
		key: strictJsonText({
			format: RECORD_IDENTITY_FRAME_FORMAT,
			version: AGENTIC_MEMORY_RECORD_USE_VERSION,
			record: frame,
		}),
	});
	return Object.freeze({ record, identity, inputIndex });
}

function assertRecordUseRecordDataContainers(value: unknown): void {
	assertDataObject(value, "record-use current record");
	const fragment = value.fragment;
	assertDataObject(fragment, "record-use current record fragment");
	if (value.scope !== undefined) {
		assertDataObject(value.scope, "record-use current record scope");
	}
	assertDataArray(fragment.tags, "record-use current record fragment tags");
	assertDataArray(fragment.sources, "record-use current record fragment sources");
	if (fragment.embedding !== undefined) {
		assertDataArray(fragment.embedding, "record-use current record fragment embedding");
	}
	strictCanonicalJsonBytes(fragment.payload);
}

function assertDataArray(value: unknown, label: string): asserts value is readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	const length = observedArrayLength(value);
	if (length === undefined || dataArrayContainerErrors(value, label, length).length > 0) {
		throw new TypeError(`${label} must be a dense data array`);
	}
}

function assertRequestIdentity(value: unknown): AgenticMemoryRecordUseRequestIdentity {
	assertDataObject(value, "record-use request identity");
	assertExactFields(value, ["algorithm", "key", "version"], "record-use request identity");
	if (value.version !== AGENTIC_MEMORY_RECORD_USE_VERSION) {
		throw new TypeError("record-use request identity has an invalid version");
	}
	if (value.algorithm !== AGENTIC_MEMORY_RECORD_USE_REQUEST_IDENTITY_ALGORITHM) {
		throw new TypeError("record-use request identity has an invalid algorithm");
	}
	if (!isNonEmptyString(value.key)) {
		throw new TypeError("record-use request identity key must be a non-empty string");
	}
	const decoded = strictJsonCodec.decode(textEncoder.encode(value.key));
	assertDataObject(decoded, "record-use request identity frame");
	assertExactFields(decoded, ["format", "request", "version"], "record-use request identity frame");
	if (
		decoded.format !== REQUEST_IDENTITY_FRAME_FORMAT ||
		decoded.version !== AGENTIC_MEMORY_RECORD_USE_VERSION
	) {
		throw new TypeError("record-use request identity frame is invalid");
	}
	const canonical = agenticMemoryRecordUseRequestIdentity(decoded.request);
	if (canonical.key !== value.key) {
		throw new TypeError("record-use request identity is not canonical");
	}
	return canonical;
}

function assertRecordIdentity(value: unknown): {
	readonly identity: AgenticMemoryRecordUseRecordIdentity;
	readonly recordId: string;
} {
	assertDataObject(value, "record-use record identity");
	assertExactFields(value, ["algorithm", "key", "version"], "record-use record identity");
	if (value.version !== AGENTIC_MEMORY_RECORD_USE_VERSION) {
		throw new TypeError("record-use record identity has an invalid version");
	}
	if (value.algorithm !== AGENTIC_MEMORY_RECORD_USE_RECORD_IDENTITY_ALGORITHM) {
		throw new TypeError("record-use record identity has an invalid algorithm");
	}
	if (!isNonEmptyString(value.key)) {
		throw new TypeError("record-use record identity key must be a non-empty string");
	}
	const decoded = strictJsonCodec.decode(textEncoder.encode(value.key));
	assertDataObject(decoded, "record-use record identity frame");
	assertExactFields(decoded, ["format", "record", "version"], "record-use record identity frame");
	if (
		decoded.format !== RECORD_IDENTITY_FRAME_FORMAT ||
		decoded.version !== AGENTIC_MEMORY_RECORD_USE_VERSION
	) {
		throw new TypeError("record-use record identity frame is invalid");
	}
	const frame = assertAgenticMemoryRecordFrame<StrictJsonValue>(decoded.record);
	const canonicalKey = strictJsonText({
		format: RECORD_IDENTITY_FRAME_FORMAT,
		version: AGENTIC_MEMORY_RECORD_USE_VERSION,
		record: frame,
	});
	if (canonicalKey !== value.key) {
		throw new TypeError("record-use record identity is not canonical");
	}
	return Object.freeze({
		identity: Object.freeze({
			version: AGENTIC_MEMORY_RECORD_USE_VERSION,
			algorithm: AGENTIC_MEMORY_RECORD_USE_RECORD_IDENTITY_ALGORITHM,
			key: value.key,
		}),
		recordId: frame.record.id,
	});
}

function decisionClaim(value: unknown): DecisionClaim | undefined {
	if (!isPlainRecord(value) || dataRecordContainerErrors(value, "decision claim").length > 0) {
		return undefined;
	}
	const requestKey = identityClaimKey(
		Object.getOwnPropertyDescriptor(value, "requestIdentity")?.value,
		AGENTIC_MEMORY_RECORD_USE_REQUEST_IDENTITY_ALGORITHM,
	);
	const recordKey = identityClaimKey(
		Object.getOwnPropertyDescriptor(value, "recordIdentity")?.value,
		AGENTIC_MEMORY_RECORD_USE_RECORD_IDENTITY_ALGORITHM,
	);
	const recordId = safeDataString(value, "recordId");
	if (requestKey === undefined || recordKey === undefined || recordId === undefined) {
		return undefined;
	}
	return { requestKey, recordKey, recordId };
}

function identityClaimKey(value: unknown, algorithm: string): string | undefined {
	if (!isPlainRecord(value) || dataRecordContainerErrors(value, "identity claim").length > 0) {
		return undefined;
	}
	const algorithmValue = safeDataString(value, "algorithm");
	const key = safeDataString(value, "key");
	return algorithmValue === algorithm ? key : undefined;
}

function globalFailure<TJson extends StrictJsonValue>(
	reason: Extract<
		AgenticMemoryRecordUseReasonCode,
		"input-overflow" | "invalid-input" | "invalid-request" | "invalid-record" | "invalid-decision"
	>,
	evaluation: number,
	inputRecords: number,
	inputDecisions: number,
): AgenticMemoryRecordUseSnapshot<TJson> {
	const diagnostics = emptyDiagnostics();
	addIssue(diagnostics, reason);
	for (
		let index = 0;
		index < Math.min(inputRecords, AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.exclusions);
		index += 1
	) {
		addExclusion(diagnostics, reason);
	}
	for (
		let index = 0;
		index < Math.min(inputRecords, AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.audit);
		index += 1
	) {
		addAudit(diagnostics, { action: "invalid-input", reason });
	}
	const missingExclusionTotals = Math.max(0, inputRecords - diagnostics.exclusions.length);
	diagnostics.reasonCounts[reason] += missingExclusionTotals;
	if (inputRecords === 0) diagnostics.reasonCounts[reason] += 1;
	return finishSnapshot<TJson>({
		evaluation,
		inputRecords,
		validRecords: 0,
		invalidRecords: 0,
		unevaluatedRecords: inputRecords,
		inputDecisions,
		validDecisions: 0,
		invalidDecisions: 0,
		unevaluatedDecisions: inputDecisions,
		allowedRecords: [],
		deniedRecords: 0,
		excludedRecords: inputRecords,
		diagnostics,
		exclusionTotalOverride: inputRecords,
		auditTotalOverride: inputRecords,
	});
}

function finishSnapshot<TJson extends StrictJsonValue>(input: {
	readonly evaluation: number;
	readonly inputRecords: number;
	readonly validRecords: number;
	readonly invalidRecords: number;
	readonly unevaluatedRecords?: number;
	readonly inputDecisions: number;
	readonly validDecisions: number;
	readonly invalidDecisions: number;
	readonly unevaluatedDecisions?: number;
	readonly allowedRecords: readonly AgenticMemoryRecord<TJson>[];
	readonly deniedRecords: number;
	readonly excludedRecords: number;
	readonly diagnostics: EvaluationDiagnostics;
	readonly exclusionTotalOverride?: number;
	readonly auditTotalOverride?: number;
}): AgenticMemoryRecordUseSnapshot<TJson> {
	const exclusions = bounded(
		input.diagnostics.exclusions,
		AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.exclusions,
		compareExclusions,
		input.exclusionTotalOverride,
	);
	const issues = bounded(
		input.diagnostics.issues,
		AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.issues,
		compareIssues,
	);
	const audit = bounded(
		input.diagnostics.audit,
		AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.audit,
		compareAudit,
		input.auditTotalOverride,
	);
	const cursor: AgenticMemoryRecordUseCursor = Object.freeze({
		kind: "agentic-memory-record-use-cursor",
		version: AGENTIC_MEMORY_RECORD_USE_VERSION,
		evaluation: input.evaluation,
		inputRecords: input.inputRecords,
		validRecords: input.validRecords,
		invalidRecords: input.invalidRecords,
		unevaluatedRecords: input.unevaluatedRecords ?? 0,
		inputDecisions: input.inputDecisions,
		validDecisions: input.validDecisions,
		invalidDecisions: input.invalidDecisions,
		unevaluatedDecisions: input.unevaluatedDecisions ?? 0,
		allowedRecords: input.allowedRecords.length,
		deniedRecords: input.deniedRecords,
		excludedRecords: input.excludedRecords,
		reasonCounts: Object.freeze({ ...input.diagnostics.reasonCounts }),
		exclusions: exclusions.cursor,
		issues: issues.cursor,
		audit: audit.cursor,
	});
	return Object.freeze({
		format: AGENTIC_MEMORY_RECORD_USE_SNAPSHOT_FORMAT,
		version: AGENTIC_MEMORY_RECORD_USE_VERSION,
		allowedRecords: Object.freeze([...input.allowedRecords]),
		exclusions: exclusions.values,
		status: Object.freeze({
			kind: "agentic-memory-record-use-status",
			version: AGENTIC_MEMORY_RECORD_USE_VERSION,
			state: input.diagnostics.issues.length === 0 ? "ready" : "invalid",
			evaluated: true,
		}),
		issues: issues.values,
		audit: audit.values,
		cursor,
	});
}

function emptyDiagnostics(): EvaluationDiagnostics {
	return {
		exclusions: [],
		issues: [],
		audit: [],
		reasonCounts: Object.fromEntries(REASON_ORDER.map((reason) => [reason, 0])) as Record<
			AgenticMemoryRecordUseReasonCode,
			number
		>,
	};
}

function addRecordFault(
	diagnostics: EvaluationDiagnostics,
	reason: Extract<AgenticMemoryRecordUseReasonCode, "invalid-record" | "duplicate-record">,
): void {
	addExclusion(diagnostics, reason);
	addIssue(diagnostics, reason);
	addAudit(diagnostics, { action: "invalid-input", reason });
}

function addDecisionFault(diagnostics: EvaluationDiagnostics, reason: "invalid-decision"): void {
	addExclusion(diagnostics, reason);
	addIssue(diagnostics, reason);
	addAudit(diagnostics, { action: "invalid-input", reason });
}

function addExclusion(
	diagnostics: EvaluationDiagnostics,
	reason: AgenticMemoryRecordUseReasonCode,
): void {
	diagnostics.exclusions.push(
		Object.freeze({
			kind: "agentic-memory-record-use-exclusion",
			version: AGENTIC_MEMORY_RECORD_USE_VERSION,
			reason,
		}),
	);
	diagnostics.reasonCounts[reason] += 1;
}

function addIssue(
	diagnostics: EvaluationDiagnostics,
	reason: AgenticMemoryRecordUseReasonCode,
): void {
	diagnostics.issues.push(
		Object.freeze({
			kind: "issue",
			version: AGENTIC_MEMORY_RECORD_USE_VERSION,
			code: reason,
			message: REASON_MESSAGE[reason],
			severity: "error",
			source: "agentic-memory-record-use-gate",
		}),
	);
}

function addAudit(
	diagnostics: EvaluationDiagnostics,
	entry: Omit<AgenticMemoryRecordUseAuditEntry, "kind" | "version">,
): void {
	diagnostics.audit.push(
		Object.freeze({
			kind: "agentic-memory-record-use-audit",
			version: AGENTIC_MEMORY_RECORD_USE_VERSION,
			...entry,
		}),
	);
}

function addRecordAnomaly(
	anomalies: Map<string, Set<AgenticMemoryRecordUseReasonCode>>,
	recordId: string,
	reason: "request-mismatch" | "stale-record",
): void {
	const current = anomalies.get(recordId);
	if (current === undefined) anomalies.set(recordId, new Set([reason]));
	else current.add(reason);
}

function bounded<T>(
	values: readonly T[],
	limit: number,
	compare: (left: T, right: T) => number,
	totalOverride?: number,
): {
	readonly values: readonly T[];
	readonly cursor: AgenticMemoryRecordUseBoundedCollectionCursor;
} {
	const sorted = [...values].sort(compare);
	const total = totalOverride ?? sorted.length;
	const emitted = Math.min(sorted.length, limit);
	return Object.freeze({
		values: Object.freeze(sorted.slice(0, emitted)),
		cursor: Object.freeze({
			kind: "agentic-memory-record-use-bounded-collection-cursor",
			version: AGENTIC_MEMORY_RECORD_USE_VERSION,
			total,
			emitted,
			truncated: total > emitted,
		}),
	});
}

function decisionCoordinate(requestKey: string, recordId: string, recordKey: string): string {
	return canonicalTupleKey([requestKey, recordId, recordKey]);
}

function strictJsonText(value: unknown): string {
	return textDecoder.decode(strictCanonicalJsonBytes(value));
}

function assertDataObject(value: unknown, label: string): asserts value is Record<string, unknown> {
	if (!isPlainRecord(value) || dataRecordContainerErrors(value, label).length > 0) {
		throw new TypeError(`${label} must be a plain data object`);
	}
}

function assertExactFields(
	value: Record<string, unknown>,
	fields: readonly string[],
	label: string,
): void {
	const expected = [...fields].sort();
	const actual = Object.keys(value).sort();
	if (
		expected.length !== actual.length ||
		expected.some((field, index) => field !== actual[index])
	) {
		throw new TypeError(`${label} has unexpected or missing fields`);
	}
}

function safeDataString(value: unknown, key: string): string | undefined {
	if (!isPlainRecord(value)) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor !== undefined &&
		"value" in descriptor &&
		typeof descriptor.value === "string" &&
		descriptor.value.length > 0
		? descriptor.value
		: undefined;
}

function observedArrayLength(value: readonly unknown[]): number | undefined {
	const length = safeArrayLength(value);
	return typeof length === "number" &&
		Number.isSafeInteger(length) &&
		length >= 0 &&
		!Object.is(length, -0)
		? length
		: undefined;
}

function arrayLength(value: unknown): number | undefined {
	if (!Array.isArray(value)) return 0;
	return observedArrayLength(value);
}

function safeInputLength(value: unknown): number {
	try {
		return arrayLength(value) ?? 0;
	} catch {
		return 0;
	}
}

function compareCanonicalRecords<TJson extends StrictJsonValue>(
	left: CanonicalRecord<TJson>,
	right: CanonicalRecord<TJson>,
): number {
	return (
		compareText(left.record.id, right.record.id) ||
		compareText(left.identity.key, right.identity.key) ||
		left.inputIndex - right.inputIndex
	);
}

function compareValidDecisions(left: ValidDecision, right: ValidDecision): number {
	return (
		compareText(left.decision.recordId, right.decision.recordId) ||
		compareText(left.decision.requestIdentity.key, right.decision.requestIdentity.key) ||
		compareText(left.decision.recordIdentity.key, right.decision.recordIdentity.key) ||
		compareText(left.decision.state, right.decision.state) ||
		compareText(left.decision.decisionId, right.decision.decisionId) ||
		left.inputIndex - right.inputIndex
	);
}

function compareExclusions(
	left: AgenticMemoryRecordUseExclusion,
	right: AgenticMemoryRecordUseExclusion,
): number {
	return reasonIndex(left.reason) - reasonIndex(right.reason);
}

function compareIssues(
	left: AgenticMemoryRecordUseIssue,
	right: AgenticMemoryRecordUseIssue,
): number {
	return reasonIndex(left.code) - reasonIndex(right.code);
}

function compareAudit(
	left: AgenticMemoryRecordUseAuditEntry,
	right: AgenticMemoryRecordUseAuditEntry,
): number {
	return (
		compareText(left.action, right.action) || reasonIndex(left.reason) - reasonIndex(right.reason)
	);
}

function reasonIndex(reason: AgenticMemoryRecordUseReasonCode | undefined): number {
	return reason === undefined ? -1 : REASON_ORDER.indexOf(reason);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
