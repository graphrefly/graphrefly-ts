import { depLatest } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import { canonicalTupleKey } from "../../identity.js";
import { strictCanonicalJsonBytes, strictJsonCodec } from "../../json/codec.js";
import type { FactId } from "../../patterns/semantic-memory.js";
import { agenticMemoryRecordFrame, assertAgenticMemoryRecordFrame } from "./frame.js";
import { solutionProjection } from "./projection.js";
import { AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM } from "./record-application.js";
import {
	cloneStrictJsonObject,
	errorMessage,
	forbiddenAgenticMemoryDataFields,
	isNonEmptyString,
	isPlainRecord,
	safeArrayLength,
	snapshotAgenticMemoryFactRefs,
	validateAgenticMemoryFactRefs,
} from "./shared.js";
import type {
	AgenticMemoryFactRef,
	AgenticMemoryRecord,
	AgenticMemoryRecordApplicationDecision,
	AgenticMemoryRecordApplicationEvidence,
	AgenticMemoryRecordApplicationEvidenceFactsBundle,
	AgenticMemoryRecordApplicationEvidenceFactsBundleOptions,
	AgenticMemoryRecordApplicationEvidenceFactsProjection,
	AgenticMemoryRecordApplicationEvidenceProjectionAuditEntry,
	AgenticMemoryRecordApplicationEvidenceProjectionStatus,
	AgenticMemoryRecordApplicationOperation,
	AgenticMemoryRecordApplicationPriorEvidence,
	AgenticMemoryRecordApplicationPriorEvidenceBundle,
	AgenticMemoryRecordApplicationPriorEvidenceBundleOptions,
	AgenticMemoryRecordApplicationPriorEvidenceCursor,
	AgenticMemoryRecordApplicationPriorEvidenceProjection,
	StrictJsonValue,
} from "./types.js";

const AGENTIC_MEMORY_RECORD_APPLICATION_OPERATION_VERSION = 1 as const;
const AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_FRAME_FORMAT =
	"graphrefly.agenticMemoryRecordApplicationMaterial";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/**
 * Projects application evidence facts into the D584 priorEvidence DATA shape.
 *
 * The result is only an idempotency/history read model for later application
 * evaluations. It performs no record mutation, admission, storage I/O,
 * hydration, provider/runtime call, or same-evaluation feedback wiring.
 *
 * @param evidenceFacts - Evidence facts or an existing priorEvidence wrapper.
 * @param opts - Optional projection evaluation and provenance material.
 * @returns Prior-evidence projection plus DATA status/issues/audit/cursor.
 * @category solutions
 * @example
 * ```ts
 * import { projectAgenticMemoryRecordApplicationPriorEvidence } from "@graphrefly/ts/solutions/agentic-memory";
 * ```
 */
export function projectAgenticMemoryRecordApplicationPriorEvidence(
	evidenceFacts: unknown,
	opts: {
		readonly evaluation?: number;
		readonly sourceRefs?: AgenticMemoryRecordApplicationPriorEvidence["sourceRefs"];
		readonly policyRefs?: AgenticMemoryRecordApplicationPriorEvidence["policyRefs"];
		readonly metadata?: AgenticMemoryRecordApplicationPriorEvidence["metadata"];
	} = {},
): AgenticMemoryRecordApplicationPriorEvidenceProjection {
	const validation = validatePriorEvidenceInput(evidenceFacts);
	const aggregation = aggregateEvidence(validation.entries);
	const optionErrors: string[] = [];
	const sourceRefs =
		opts.sourceRefs === undefined
			? validation.sourceRefs
			: snapshotFactRefs(opts.sourceRefs, "priorEvidence.sourceRefs", optionErrors);
	const policyRefs =
		opts.policyRefs === undefined
			? validation.policyRefs
			: snapshotFactRefs(opts.policyRefs, "priorEvidence.policyRefs", optionErrors);
	const metadata =
		opts.metadata === undefined
			? validation.metadata
			: snapshotMetadata(opts.metadata, "priorEvidence.metadata", optionErrors);
	const optionIssues =
		optionErrors.length === 0
			? []
			: [
					dataIssue(
						"agentic-memory.application-prior-evidence.invalid-options",
						"application prior evidence projection options are invalid",
						{ severity: "error", refs: optionErrors },
					),
				];
	const issues = Object.freeze([...validation.issues, ...aggregation.issues, ...optionIssues]);
	const cursor = evidenceCursor({
		evaluation: opts.evaluation ?? 0,
		applicationDecisions: 0,
		appliedDecisions: 0,
		skippedDecisions: 0,
		rejectedDecisions: 0,
		evidenceFacts: validation.totalEntries,
		validEvidenceFacts: aggregation.entries.length,
		invalidEvidenceFacts: validation.invalidEntries,
		duplicateEvidenceFacts: aggregation.duplicates,
		issues: issues.length,
	});
	const priorEvidence: AgenticMemoryRecordApplicationPriorEvidence = Object.freeze({
		kind: "agentic-memory-record-application-prior-evidence",
		entries: Object.freeze(aggregation.entries),
		...(sourceRefs === undefined ? {} : { sourceRefs }),
		...(policyRefs === undefined ? {} : { policyRefs }),
		...(metadata === undefined ? {} : { metadata }),
	});
	const audit = Object.freeze([
		...aggregation.audit,
		...issues.map((issue) =>
			auditEntry("issue-recorded", {
				reason: issue.code,
				...(issue.subjectId === undefined ? {} : { admissionId: issue.subjectId }),
			}),
		),
	]);
	return Object.freeze({
		kind: "agentic-memory-record-application-prior-evidence-projection",
		priorEvidence,
		status: evidenceStatus(cursor),
		issues,
		audit,
		cursor,
	});
}

/**
 * Projects applied application decisions into appendable D584 evidence facts.
 *
 * Only `applied` decisions become evidence. Skipped or rejected decisions remain
 * audit/status material and cannot become record-truth evidence. The returned
 * evidence is future priorEvidence material; this helper does not wire it back
 * into the same application evaluation.
 *
 * @param decisions - Application decision DATA facts.
 * @param opts - Optional projection evaluation and priorEvidence provenance.
 * @returns Appendable evidence facts plus a priorEvidence-compatible wrapper.
 * @category solutions
 * @example
 * ```ts
 * import { projectAgenticMemoryRecordApplicationEvidenceFacts } from "@graphrefly/ts/solutions/agentic-memory";
 * ```
 */
export function projectAgenticMemoryRecordApplicationEvidenceFacts<T = unknown>(
	decisions: unknown,
	opts: {
		readonly evaluation?: number;
		readonly sourceRefs?: AgenticMemoryRecordApplicationPriorEvidence["sourceRefs"];
		readonly policyRefs?: AgenticMemoryRecordApplicationPriorEvidence["policyRefs"];
		readonly metadata?: AgenticMemoryRecordApplicationPriorEvidence["metadata"];
	} = {},
): AgenticMemoryRecordApplicationEvidenceFactsProjection {
	const projection = projectEvidenceFactsFromDecisions<T>(decisions, opts.evaluation);
	const prior = projectAgenticMemoryRecordApplicationPriorEvidence(projection.evidenceFacts, opts);
	const cursor = evidenceCursor({
		...prior.cursor,
		applicationDecisions: projection.totalDecisions,
		appliedDecisions: projection.appliedDecisions,
		skippedDecisions: projection.skippedDecisions,
		rejectedDecisions: projection.rejectedDecisions,
		evidenceFacts: projection.totalEvidenceFacts,
		validEvidenceFacts: prior.cursor.validEvidenceFacts,
		invalidEvidenceFacts: projection.invalidEvidenceFacts + prior.cursor.invalidEvidenceFacts,
		issues: projection.issues.length + prior.issues.length,
	});
	const issues = Object.freeze([...projection.issues, ...prior.issues]);
	const audit = Object.freeze([...projection.audit, ...prior.audit]);
	return Object.freeze({
		kind: "agentic-memory-record-application-evidence-facts-projection",
		evidenceFacts: Object.freeze(prior.priorEvidence.entries),
		priorEvidence: Object.freeze({ ...prior.priorEvidence, entries: prior.priorEvidence.entries }),
		status: evidenceStatus(cursor),
		issues,
		audit,
		cursor,
	});
}

/**
 * Creates a graph-visible D584 priorEvidence projection bundle.
 *
 * The bundle only projects supplied evidence facts into DATA outputs. It does
 * not read application decisions and does not create an application bundle.
 * Current-evaluation decisions must only become priorEvidence through an
 * explicit event/storage graph boundary or a later evaluation input.
 *
 * @param graph - Graph that owns the created nodes.
 * @param opts - Evidence fact input node and optional bundle name.
 * @returns Projection node plus priorEvidence/status/issues/audit/cursor nodes.
 * @category solutions
 */
export function agenticMemoryRecordApplicationPriorEvidenceBundle(
	graph: Graph,
	opts: AgenticMemoryRecordApplicationPriorEvidenceBundleOptions,
): AgenticMemoryRecordApplicationPriorEvidenceBundle {
	const name = opts.name ?? "agenticMemoryRecordApplicationPriorEvidence";
	const projection = graph.node<AgenticMemoryRecordApplicationPriorEvidenceProjection>(
		[opts.evidenceFacts],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					projectAgenticMemoryRecordApplicationPriorEvidence(depLatest(ctx, 0), {
						evaluation: state.evaluation,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryRecordApplicationPriorEvidence",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { evidenceFacts: opts.evidenceFacts },
		projection,
		priorEvidence: solutionProjection(
			graph,
			projection,
			`${name}/priorEvidence`,
			"agenticMemoryRecordApplicationPriorEvidence",
			(fact) => fact.priorEvidence,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryRecordApplicationPriorEvidenceStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryRecordApplicationPriorEvidenceIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryRecordApplicationPriorEvidenceAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryRecordApplicationPriorEvidenceCursor",
			(fact) => fact.cursor,
		),
	};
}

/**
 * Creates a graph-visible D584 decision-to-evidence projection bundle.
 *
 * The output `evidenceFacts` are append material for a later evaluation or an
 * explicit host/storage/event boundary. This bundle intentionally does not
 * connect that output to an application bundle's current `priorEvidence`.
 *
 * @param graph - Graph that owns the created nodes.
 * @param opts - Application decisions input node and optional bundle name.
 * @returns Projection node plus evidenceFacts/priorEvidence/status/issues/audit/cursor nodes.
 * @category solutions
 */
export function agenticMemoryRecordApplicationEvidenceFactsBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryRecordApplicationEvidenceFactsBundleOptions<T>,
): AgenticMemoryRecordApplicationEvidenceFactsBundle<T> {
	const name = opts.name ?? "agenticMemoryRecordApplicationEvidenceFacts";
	const projection = graph.node<AgenticMemoryRecordApplicationEvidenceFactsProjection>(
		[opts.applicationDecisions],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					projectAgenticMemoryRecordApplicationEvidenceFacts<T>(depLatest(ctx, 0), {
						evaluation: state.evaluation,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryRecordApplicationEvidenceFacts",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { applicationDecisions: opts.applicationDecisions },
		projection,
		evidenceFacts: solutionProjection(
			graph,
			projection,
			`${name}/evidenceFacts`,
			"agenticMemoryRecordApplicationEvidenceFacts",
			(fact) => fact.evidenceFacts,
		),
		priorEvidence: solutionProjection(
			graph,
			projection,
			`${name}/priorEvidence`,
			"agenticMemoryRecordApplicationEvidenceFactsPriorEvidence",
			(fact) => fact.priorEvidence,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryRecordApplicationEvidenceFactsStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryRecordApplicationEvidenceFactsIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryRecordApplicationEvidenceFactsAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryRecordApplicationEvidenceFactsCursor",
			(fact) => fact.cursor,
		),
	};
}

function projectEvidenceFactsFromDecisions<T>(
	value: unknown,
	_evaluation: number | undefined,
): {
	readonly evidenceFacts: readonly AgenticMemoryRecordApplicationEvidence[];
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryRecordApplicationEvidenceProjectionAuditEntry[];
	readonly totalDecisions: number;
	readonly appliedDecisions: number;
	readonly skippedDecisions: number;
	readonly rejectedDecisions: number;
	readonly totalEvidenceFacts: number;
	readonly invalidEvidenceFacts: number;
} {
	const evidenceFacts: AgenticMemoryRecordApplicationEvidence[] = [];
	const issues: DataIssue[] = [];
	const audit: AgenticMemoryRecordApplicationEvidenceProjectionAuditEntry[] = [];
	if (!Array.isArray(value)) {
		issues.push(
			dataIssue(
				"agentic-memory.application-evidence-facts.invalid-decisions",
				"application decisions input must be an array",
				{ severity: "error" },
			),
		);
		return {
			evidenceFacts: Object.freeze(evidenceFacts),
			issues: Object.freeze(issues),
			audit: Object.freeze([
				auditEntry("issue-recorded", { reason: "application decisions input must be an array" }),
			]),
			totalDecisions: 0,
			appliedDecisions: 0,
			skippedDecisions: 0,
			rejectedDecisions: 0,
			totalEvidenceFacts: 0,
			invalidEvidenceFacts: 1,
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		issues.push(
			dataIssue(
				"agentic-memory.application-evidence-facts.invalid-decisions",
				"application decisions input length could not be read",
				{ severity: "error" },
			),
		);
		return {
			evidenceFacts: Object.freeze(evidenceFacts),
			issues: Object.freeze(issues),
			audit: Object.freeze([
				auditEntry("issue-recorded", { reason: "application decisions length failed" }),
			]),
			totalDecisions: 0,
			appliedDecisions: 0,
			skippedDecisions: 0,
			rejectedDecisions: 0,
			totalEvidenceFacts: 0,
			invalidEvidenceFacts: 1,
		};
	}
	let appliedDecisions = 0;
	let skippedDecisions = 0;
	let rejectedDecisions = 0;
	let invalidEvidenceFacts = 0;
	for (let index = 0; index < length; index += 1) {
		try {
			if (!Object.hasOwn(value, index)) {
				throw new TypeError("application decisions must be dense");
			}
			const decision = value[index] as AgenticMemoryRecordApplicationDecision<T>;
			if (!isPlainRecord(decision)) {
				invalidEvidenceFacts += 1;
				issues.push(
					dataIssue(
						"agentic-memory.application-evidence-facts.invalid-decision",
						"application decision must be an object",
						{ severity: "error", path: [index] },
					),
				);
				continue;
			}
			const commonErrors = validateApplicationDecisionCommon(decision);
			if (commonErrors.length > 0) {
				invalidEvidenceFacts += 1;
				issues.push(
					dataIssue(
						"agentic-memory.application-evidence-facts.invalid-decision",
						"application decision is invalid",
						{ severity: "error", path: [index], refs: commonErrors },
					),
				);
				continue;
			}
			if (decision.state === "skipped") {
				skippedDecisions += 1;
				audit.push(
					auditEntry("decision-skipped", {
						admissionId: decision.admissionId,
						proposalId: decision.proposalId,
						applicationId: decision.applicationId,
						reason: decision.reasonCode,
					}),
				);
				continue;
			}
			if (decision.state === "rejected") {
				rejectedDecisions += 1;
				audit.push(
					auditEntry("decision-skipped", {
						admissionId: decision.admissionId,
						proposalId: decision.proposalId,
						applicationId: decision.applicationId,
						reason: decision.reasonCode,
					}),
				);
				continue;
			}
			if (decision.state !== "applied") {
				invalidEvidenceFacts += 1;
				issues.push(
					dataIssue(
						"agentic-memory.application-evidence-facts.invalid-decision",
						"application decision state is invalid",
						{ severity: "error", path: [index] },
					),
				);
				continue;
			}
			appliedDecisions += 1;
			const projected = evidenceFromDecision(decision, index);
			if (projected.evidence === undefined) {
				invalidEvidenceFacts += 1;
				issues.push(...projected.issues);
				continue;
			}
			evidenceFacts.push(projected.evidence);
			audit.push(
				auditEntry("evidence-fact-projected", {
					admissionId: projected.evidence.admissionId,
					proposalId: projected.evidence.proposalId,
					applicationId: projected.evidence.applicationId,
					sourceRefs: projected.evidence.sourceRefs,
					policyRefs: projected.evidence.policyRefs,
				}),
			);
		} catch (error) {
			invalidEvidenceFacts += 1;
			issues.push(
				dataIssue(
					"agentic-memory.application-evidence-facts.invalid-decision",
					`application decision access failed: ${errorMessage(error)}`,
					{ severity: "error", path: [index] },
				),
			);
		}
	}
	for (const issue of issues) {
		audit.push(auditEntry("issue-recorded", { reason: issue.code }));
	}
	return {
		evidenceFacts: Object.freeze(evidenceFacts),
		issues: Object.freeze(issues),
		audit: Object.freeze(audit),
		totalDecisions: length,
		appliedDecisions,
		skippedDecisions,
		rejectedDecisions,
		totalEvidenceFacts: evidenceFacts.length + invalidEvidenceFacts,
		invalidEvidenceFacts,
	};
}

function evidenceFromDecision<T>(
	decision: AgenticMemoryRecordApplicationDecision<T>,
	index: number,
): {
	readonly evidence?: AgenticMemoryRecordApplicationEvidence;
	readonly issues: readonly DataIssue[];
} {
	const validationErrors = [
		...dataRecordContainerErrors(decision, "decision"),
		...forbiddenAgenticMemoryDataFields(decision as unknown as Record<string, unknown>, "decision"),
	];
	if (decision.kind !== "agentic-memory-record-application-decision") {
		validationErrors.push("decision.kind must be agentic-memory-record-application-decision");
	}
	for (const field of ["applicationId", "admissionId", "proposalId"] as const) {
		if (!isNonEmptyString(decision[field])) {
			validationErrors.push(`decision.${field} must be non-empty`);
		}
	}
	if (!isApplicationOperation(decision.operation)) {
		validationErrors.push("decision.operation must be create, replace, or update");
	}
	if (decision.operationVersion !== AGENTIC_MEMORY_RECORD_APPLICATION_OPERATION_VERSION) {
		validationErrors.push("decision.operationVersion must be 1");
	}
	if (!isPlainRecord(decision.candidateMaterial)) {
		validationErrors.push("decision.candidateMaterial must be an object");
	}
	const record = decision.candidateMaterial?.record;
	if (!isPlainRecord(record) || !isNonEmptyString(record.id)) {
		validationErrors.push("decision.candidateMaterial.record.id must be non-empty");
	}
	const fragment = isPlainRecord(record) ? record.fragment : undefined;
	if (!isPlainRecord(fragment) || !isNonEmptyString(fragment.id)) {
		validationErrors.push("decision.candidateMaterial.record.fragment.id must be non-empty");
	}
	const recordId = isPlainRecord(record) && isNonEmptyString(record.id) ? record.id : undefined;
	const fragmentId =
		isPlainRecord(fragment) && isNonEmptyString(fragment.id) ? fragment.id : undefined;
	const targetRecordId = decision.targetRecordId ?? recordId;
	const appliedRecord = decision.record;
	if (!isPlainRecord(appliedRecord)) {
		validationErrors.push("decision.record must be present for applied decisions");
	} else {
		if (recordId !== undefined && appliedRecord.id !== recordId) {
			validationErrors.push("decision.record.id must match candidate record id");
		}
		const appliedFragment = appliedRecord.fragment;
		if (
			fragmentId !== undefined &&
			(!isPlainRecord(appliedFragment) || appliedFragment.id !== fragmentId)
		) {
			validationErrors.push("decision.record.fragment.id must match candidate fragment id");
		}
	}
	const materialIdentity = validateApplicationMaterialIdentity(
		decision.materialIdentity,
		"decision.materialIdentity",
		validationErrors,
		{
			operation: isApplicationOperation(decision.operation) ? decision.operation : undefined,
			operationVersion: decision.operationVersion === 1 ? 1 : undefined,
			recordId,
			fragmentId,
			targetRecordId,
		},
	);
	for (const [field, refs] of [
		["sourceRefs", decision.sourceRefs],
		["policyRefs", decision.policyRefs],
		["evidenceRefs", decision.evidenceRefs],
	] as const) {
		if (refs !== undefined) {
			validationErrors.push(
				...validateAgenticMemoryFactRefs(refs).map((error) => `decision.${field}: ${error}`),
			);
		}
	}
	if (
		recordId !== undefined &&
		isNonEmptyString(decision.targetRecordId) &&
		decision.targetRecordId !== recordId
	) {
		validationErrors.push("decision.targetRecordId must equal candidate record id when present");
	}
	if (
		isPlainRecord(appliedRecord) &&
		materialIdentity !== undefined &&
		targetRecordId !== undefined
	) {
		const appliedIdentity = applicationMaterialIdentityKey({
			operation: decision.operation,
			operationVersion: AGENTIC_MEMORY_RECORD_APPLICATION_OPERATION_VERSION,
			targetRecordId,
			record: appliedRecord as unknown as AgenticMemoryRecord<T>,
		});
		if (appliedIdentity.issue !== undefined) {
			validationErrors.push(
				`decision.record material identity is invalid: ${appliedIdentity.issue}`,
			);
		} else if (appliedIdentity.key !== materialIdentity.key) {
			validationErrors.push("decision.record must match decision.materialIdentity");
		}
	}
	if (
		validationErrors.length > 0 ||
		recordId === undefined ||
		fragmentId === undefined ||
		materialIdentity === undefined ||
		!isApplicationOperation(decision.operation)
	) {
		return {
			issues: [
				dataIssue(
					"agentic-memory.application-evidence-facts.invalid-decision",
					"application decision cannot become evidence",
					{ severity: "error", path: [index], refs: validationErrors },
				),
			],
		};
	}
	return {
		evidence: Object.freeze({
			kind: "agentic-memory-record-application-evidence",
			applicationId: decision.applicationId,
			admissionId: decision.admissionId,
			proposalId: decision.proposalId,
			operation: decision.operation,
			operationVersion: AGENTIC_MEMORY_RECORD_APPLICATION_OPERATION_VERSION,
			...(decision.idempotencyKey === undefined ? {} : { idempotencyKey: decision.idempotencyKey }),
			recordId,
			fragmentId,
			targetRecordId,
			materialIdentity,
			...(decision.sourceRefs === undefined
				? {}
				: { sourceRefs: snapshotAgenticMemoryFactRefs(decision.sourceRefs) }),
			...(decision.policyRefs === undefined
				? {}
				: { policyRefs: snapshotAgenticMemoryFactRefs(decision.policyRefs) }),
			...(decision.evidenceRefs === undefined
				? {}
				: { evidenceRefs: snapshotAgenticMemoryFactRefs(decision.evidenceRefs) }),
		}),
		issues: [],
	};
}

function applicationMaterialIdentityKey<T>(input: {
	readonly operation: AgenticMemoryRecordApplicationOperation;
	readonly operationVersion: 1;
	readonly targetRecordId: FactId;
	readonly record: AgenticMemoryRecord<T>;
}): { readonly key: string; readonly issue?: undefined } | { readonly issue: string } {
	try {
		const frame = Object.freeze({
			format: AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_FRAME_FORMAT,
			version: 1,
			operation: input.operation,
			operationVersion: input.operationVersion,
			targetRecordId: input.targetRecordId,
			record: agenticMemoryRecordFrame(input.record as AgenticMemoryRecord<StrictJsonValue>),
		});
		return { key: textDecoder.decode(strictCanonicalJsonBytes(frame)) };
	} catch (error) {
		return { issue: errorMessage(error) };
	}
}

function validatePriorEvidenceInput(value: unknown): {
	readonly entries: readonly AgenticMemoryRecordApplicationEvidence[];
	readonly issues: readonly DataIssue[];
	readonly invalidEntries: number;
	readonly totalEntries: number;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
} {
	try {
		return validatePriorEvidenceInputInner(value);
	} catch (error) {
		return {
			entries: Object.freeze([]),
			invalidEntries: 1,
			totalEntries: 1,
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.application-prior-evidence.invalid",
					`application prior evidence access failed: ${errorMessage(error)}`,
					{ severity: "error" },
				),
			]),
		};
	}
}

function validatePriorEvidenceInputInner(value: unknown): {
	readonly entries: readonly AgenticMemoryRecordApplicationEvidence[];
	readonly issues: readonly DataIssue[];
	readonly invalidEntries: number;
	readonly totalEntries: number;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
} {
	let rawEntries: unknown;
	let sourceRefs: readonly AgenticMemoryFactRef[] | undefined;
	let policyRefs: readonly AgenticMemoryFactRef[] | undefined;
	let metadata: Readonly<Record<string, StrictJsonValue>> | undefined;
	if (value === undefined) {
		rawEntries = [];
	} else if (Array.isArray(value)) {
		rawEntries = value;
	} else if (isPlainRecord(value)) {
		const validationErrors = [
			...dataRecordContainerErrors(value, "priorEvidence"),
			...forbiddenAgenticMemoryDataFields(value, "priorEvidence"),
		];
		if (value.kind !== "agentic-memory-record-application-prior-evidence") {
			validationErrors.push(
				"priorEvidence.kind must be agentic-memory-record-application-prior-evidence",
			);
		}
		sourceRefs =
			value.sourceRefs === undefined
				? undefined
				: snapshotFactRefs(value.sourceRefs, "priorEvidence.sourceRefs", validationErrors);
		policyRefs =
			value.policyRefs === undefined
				? undefined
				: snapshotFactRefs(value.policyRefs, "priorEvidence.policyRefs", validationErrors);
		metadata = snapshotMetadata(value.metadata, "priorEvidence.metadata", validationErrors);
		if (validationErrors.length > 0) {
			return {
				entries: Object.freeze([]),
				invalidEntries: 1,
				totalEntries: 1,
				issues: Object.freeze([
					dataIssue(
						"agentic-memory.application-prior-evidence.invalid",
						"application prior evidence is invalid",
						{ severity: "error", refs: validationErrors },
					),
				]),
			};
		}
		rawEntries = value.entries;
	} else {
		return {
			entries: Object.freeze([]),
			invalidEntries: 1,
			totalEntries: 1,
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.application-prior-evidence.invalid",
					"application prior evidence must be an object or array",
					{ severity: "error" },
				),
			]),
		};
	}
	if (!Array.isArray(rawEntries)) {
		return {
			entries: Object.freeze([]),
			invalidEntries: 1,
			totalEntries: 1,
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.application-prior-evidence.invalid",
					"application prior evidence entries must be an array",
					{ severity: "error" },
				),
			]),
		};
	}
	const length = safeArrayLength(rawEntries);
	if (length === undefined) {
		return {
			entries: Object.freeze([]),
			invalidEntries: 1,
			totalEntries: 1,
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.application-prior-evidence.invalid",
					"application prior evidence entries length could not be read",
					{ severity: "error" },
				),
			]),
		};
	}
	const entries: AgenticMemoryRecordApplicationEvidence[] = [];
	const issues: DataIssue[] = [];
	let invalidEntries = 0;
	for (let index = 0; index < length; index += 1) {
		try {
			if (!Object.hasOwn(rawEntries, index)) {
				throw new TypeError("prior evidence entries must be dense");
			}
			const validation = validateApplicationEvidence(rawEntries[index], index);
			if (validation.evidence === undefined) {
				invalidEntries += 1;
				issues.push(...validation.issues);
				continue;
			}
			entries.push(validation.evidence);
		} catch (error) {
			invalidEntries += 1;
			issues.push(
				dataIssue(
					"agentic-memory.application-prior-evidence.invalid-entry",
					`application prior evidence entry access failed: ${errorMessage(error)}`,
					{ severity: "error", path: [index] },
				),
			);
		}
	}
	return {
		entries: Object.freeze(entries),
		invalidEntries,
		totalEntries: length,
		issues: Object.freeze(issues),
		...(sourceRefs === undefined ? {} : { sourceRefs }),
		...(policyRefs === undefined ? {} : { policyRefs }),
		...(metadata === undefined ? {} : { metadata }),
	};
}

function validateApplicationDecisionCommon(
	decision: AgenticMemoryRecordApplicationDecision<unknown>,
): readonly string[] {
	const validationErrors = [
		...dataRecordContainerErrors(decision, "decision"),
		...forbiddenAgenticMemoryDataFields(decision as unknown as Record<string, unknown>, "decision"),
	];
	if (decision.kind !== "agentic-memory-record-application-decision") {
		validationErrors.push("decision.kind must be agentic-memory-record-application-decision");
	}
	for (const field of ["applicationId", "admissionId", "proposalId"] as const) {
		if (!isNonEmptyString(decision[field])) {
			validationErrors.push(`decision.${field} must be non-empty`);
		}
	}
	if (!isApplicationOperation(decision.operation)) {
		validationErrors.push("decision.operation must be create, replace, or update");
	}
	if (decision.operationVersion !== AGENTIC_MEMORY_RECORD_APPLICATION_OPERATION_VERSION) {
		validationErrors.push("decision.operationVersion must be 1");
	}
	if (
		decision.state !== "applied" &&
		decision.state !== "skipped" &&
		decision.state !== "rejected"
	) {
		validationErrors.push("decision.state must be applied, skipped, or rejected");
	}
	if (!isNonEmptyString(decision.reasonCode)) {
		validationErrors.push("decision.reasonCode must be non-empty");
	}
	if (!isPlainRecord(decision.candidateMaterial)) {
		validationErrors.push("decision.candidateMaterial must be an object");
	}
	const record = decision.candidateMaterial?.record;
	if (!isPlainRecord(record) || !isNonEmptyString(record.id)) {
		validationErrors.push("decision.candidateMaterial.record.id must be non-empty");
	}
	const fragment = isPlainRecord(record) ? record.fragment : undefined;
	if (!isPlainRecord(fragment) || !isNonEmptyString(fragment.id)) {
		validationErrors.push("decision.candidateMaterial.record.fragment.id must be non-empty");
	}
	for (const [field, refs] of [
		["sourceRefs", decision.sourceRefs],
		["policyRefs", decision.policyRefs],
		["evidenceRefs", decision.evidenceRefs],
	] as const) {
		if (refs !== undefined) {
			validationErrors.push(
				...validateAgenticMemoryFactRefs(refs).map((error) => `decision.${field}: ${error}`),
			);
		}
	}
	return Object.freeze(validationErrors);
}

function validateApplicationEvidence(
	value: unknown,
	index: number,
): {
	readonly evidence?: AgenticMemoryRecordApplicationEvidence;
	readonly issues: readonly DataIssue[];
} {
	if (!isPlainRecord(value)) {
		return {
			issues: [
				dataIssue(
					"agentic-memory.application-prior-evidence.invalid-entry",
					"evidence must be an object",
					{ severity: "error", path: [index] },
				),
			],
		};
	}
	const validationErrors = [
		...dataRecordContainerErrors(value, "evidence"),
		...forbiddenAgenticMemoryDataFields(value, "evidence"),
	];
	if (value.kind !== "agentic-memory-record-application-evidence") {
		validationErrors.push("evidence.kind must be agentic-memory-record-application-evidence");
	}
	if (!isApplicationOperation(value.operation)) {
		validationErrors.push("evidence.operation must be create, replace, or update");
	}
	if (value.operationVersion !== AGENTIC_MEMORY_RECORD_APPLICATION_OPERATION_VERSION) {
		validationErrors.push("evidence.operationVersion must be 1");
	}
	for (const field of [
		"applicationId",
		"admissionId",
		"proposalId",
		"idempotencyKey",
		"recordId",
		"fragmentId",
		"targetRecordId",
	] as const) {
		if (value[field] !== undefined && !isNonEmptyString(value[field])) {
			validationErrors.push(`evidence.${field} must be non-empty when present`);
		}
	}
	if (!isNonEmptyString(value.admissionId)) {
		validationErrors.push("evidence.admissionId must be non-empty");
	}
	if (!isNonEmptyString(value.recordId)) {
		validationErrors.push("evidence.recordId must be non-empty");
	}
	if (!isNonEmptyString(value.fragmentId)) {
		validationErrors.push("evidence.fragmentId must be non-empty");
	}
	if (
		(value.operation === "replace" || value.operation === "update") &&
		value.targetRecordId === undefined
	) {
		validationErrors.push(`${value.operation} evidence.targetRecordId must be present`);
	}
	if (
		isNonEmptyString(value.recordId) &&
		isNonEmptyString(value.targetRecordId) &&
		value.targetRecordId !== value.recordId
	) {
		validationErrors.push("evidence.targetRecordId must equal recordId when present");
	}
	const materialIdentity = validateApplicationMaterialIdentity(
		value.materialIdentity,
		"evidence.materialIdentity",
		validationErrors,
		{
			operation: isApplicationOperation(value.operation) ? value.operation : undefined,
			operationVersion: value.operationVersion === 1 ? 1 : undefined,
			recordId: isNonEmptyString(value.recordId) ? value.recordId : undefined,
			fragmentId: isNonEmptyString(value.fragmentId) ? value.fragmentId : undefined,
			targetRecordId: isNonEmptyString(value.targetRecordId)
				? value.targetRecordId
				: isNonEmptyString(value.recordId)
					? value.recordId
					: undefined,
		},
	);
	for (const [field, refs] of [
		["sourceRefs", value.sourceRefs],
		["policyRefs", value.policyRefs],
		["evidenceRefs", value.evidenceRefs],
	] as const) {
		if (refs !== undefined) {
			validationErrors.push(
				...validateAgenticMemoryFactRefs(refs).map((error) => `evidence.${field}: ${error}`),
			);
		}
	}
	const metadata = snapshotMetadata(value.metadata, "evidence.metadata", validationErrors);
	if (validationErrors.length > 0 || materialIdentity === undefined) {
		return {
			issues: [
				dataIssue(
					"agentic-memory.application-prior-evidence.invalid-entry",
					"evidence is invalid",
					{ severity: "error", path: [index], refs: validationErrors },
				),
			],
		};
	}
	return {
		evidence: Object.freeze({
			kind: "agentic-memory-record-application-evidence",
			...(value.applicationId === undefined
				? {}
				: { applicationId: value.applicationId as FactId }),
			admissionId: value.admissionId as FactId,
			...(value.proposalId === undefined ? {} : { proposalId: value.proposalId as FactId }),
			operation: value.operation as AgenticMemoryRecordApplicationOperation,
			operationVersion: AGENTIC_MEMORY_RECORD_APPLICATION_OPERATION_VERSION,
			...(value.idempotencyKey === undefined
				? {}
				: { idempotencyKey: value.idempotencyKey as string }),
			recordId: value.recordId as FactId,
			fragmentId: value.fragmentId as FactId,
			...(value.targetRecordId === undefined
				? {}
				: { targetRecordId: value.targetRecordId as FactId }),
			materialIdentity,
			...(value.sourceRefs === undefined
				? {}
				: { sourceRefs: snapshotAgenticMemoryFactRefs(value.sourceRefs) }),
			...(value.policyRefs === undefined
				? {}
				: { policyRefs: snapshotAgenticMemoryFactRefs(value.policyRefs) }),
			...(value.evidenceRefs === undefined
				? {}
				: { evidenceRefs: snapshotAgenticMemoryFactRefs(value.evidenceRefs) }),
			...(metadata === undefined ? {} : { metadata }),
		}),
		issues: [],
	};
}

function aggregateEvidence(entries: readonly AgenticMemoryRecordApplicationEvidence[]): {
	readonly entries: readonly AgenticMemoryRecordApplicationEvidence[];
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryRecordApplicationEvidenceProjectionAuditEntry[];
	readonly duplicates: number;
} {
	const out: AgenticMemoryRecordApplicationEvidence[] = [];
	const seenExact = new Set<string>();
	const byAdmission = new Map<FactId, AgenticMemoryRecordApplicationEvidence[]>();
	const byIdempotency = new Map<string, AgenticMemoryRecordApplicationEvidence[]>();
	const issues: DataIssue[] = [];
	const audit: AgenticMemoryRecordApplicationEvidenceProjectionAuditEntry[] = [];
	let duplicates = 0;
	for (const entry of entries) {
		const exactKey = evidenceExactKey(entry);
		if (seenExact.has(exactKey)) {
			duplicates += 1;
			audit.push(
				auditEntry("duplicate-suppressed", {
					admissionId: entry.admissionId,
					proposalId: entry.proposalId,
					applicationId: entry.applicationId,
				}),
			);
			continue;
		}
		seenExact.add(exactKey);
		const admissionEntries = byAdmission.get(entry.admissionId) ?? [];
		const conflictingAdmission = admissionEntries.find((candidate) =>
			evidenceConflict(candidate, entry),
		);
		if (conflictingAdmission !== undefined) {
			issues.push(
				dataIssue(
					"agentic-memory.application-prior-evidence.conflicting-admission-evidence",
					"application prior evidence reuses admissionId with conflicting material",
					{ severity: "error", subjectId: entry.admissionId },
				),
			);
		}
		admissionEntries.push(entry);
		byAdmission.set(entry.admissionId, admissionEntries);
		if (entry.idempotencyKey !== undefined) {
			const idempotencyEntries = byIdempotency.get(entry.idempotencyKey) ?? [];
			const conflictingIdempotency = idempotencyEntries.find((candidate) =>
				evidenceConflict(candidate, entry),
			);
			if (conflictingIdempotency !== undefined) {
				issues.push(
					dataIssue(
						"agentic-memory.application-prior-evidence.conflicting-idempotency-evidence",
						"application prior evidence reuses idempotencyKey with conflicting material",
						{ severity: "error", subjectId: entry.idempotencyKey, refs: [entry.admissionId] },
					),
				);
			}
			idempotencyEntries.push(entry);
			byIdempotency.set(entry.idempotencyKey, idempotencyEntries);
		}
		out.push(entry);
		audit.push(
			auditEntry("prior-evidence-projected", {
				admissionId: entry.admissionId,
				proposalId: entry.proposalId,
				applicationId: entry.applicationId,
				sourceRefs: entry.sourceRefs,
				policyRefs: entry.policyRefs,
			}),
		);
	}
	return {
		entries: Object.freeze(out),
		issues: Object.freeze(issues),
		audit: Object.freeze(audit),
		duplicates,
	};
}

function validateApplicationMaterialIdentity(
	value: unknown,
	label: string,
	validationErrors: string[],
	context: {
		readonly operation?: AgenticMemoryRecordApplicationOperation;
		readonly operationVersion?: 1;
		readonly recordId?: FactId;
		readonly fragmentId?: FactId;
		readonly targetRecordId?: FactId;
	},
): AgenticMemoryRecordApplicationEvidence["materialIdentity"] | undefined {
	if (!isPlainRecord(value)) {
		validationErrors.push(`${label} must be an object`);
		return undefined;
	}
	validationErrors.push(
		...dataRecordContainerErrors(value, label),
		...forbiddenAgenticMemoryDataFields(value, label),
	);
	const extraFields = unexpectedFields(value, ["algorithm", "key"]);
	if (extraFields.length > 0) {
		validationErrors.push(`${label} has unexpected fields: ${extraFields.join(", ")}`);
	}
	if (value.algorithm !== AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM) {
		validationErrors.push(
			`${label}.algorithm must be ${AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM}`,
		);
	}
	if (!isNonEmptyString(value.key)) {
		validationErrors.push(`${label}.key must be a non-empty string`);
	}
	if (isNonEmptyString(value.key)) {
		validateApplicationMaterialIdentityKey(value.key, label, context, validationErrors);
	}
	if (
		value.algorithm !== AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM ||
		!isNonEmptyString(value.key) ||
		extraFields.length > 0
	) {
		return undefined;
	}
	return Object.freeze({
		algorithm: AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM,
		key: value.key,
	});
}

function validateApplicationMaterialIdentityKey(
	key: string,
	label: string,
	context: {
		readonly operation?: AgenticMemoryRecordApplicationOperation;
		readonly operationVersion?: 1;
		readonly recordId?: FactId;
		readonly fragmentId?: FactId;
		readonly targetRecordId?: FactId;
	},
	validationErrors: string[],
): void {
	let decoded: unknown;
	try {
		decoded = strictJsonCodec.decode(textEncoder.encode(key));
	} catch (error) {
		validationErrors.push(`${label}.key must be canonical strict JSON: ${errorMessage(error)}`);
		return;
	}
	if (!isPlainRecord(decoded)) {
		validationErrors.push(`${label}.key frame must be an object`);
		return;
	}
	const frame = decoded as Record<string, unknown>;
	const extraFields = unexpectedFields(frame, [
		"format",
		"operation",
		"operationVersion",
		"record",
		"targetRecordId",
		"version",
	]);
	if (extraFields.length > 0) {
		validationErrors.push(`${label}.key frame has unexpected fields: ${extraFields.join(", ")}`);
	}
	if (frame.format !== AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_FRAME_FORMAT) {
		validationErrors.push(`${label}.key frame format is invalid`);
	}
	if (frame.version !== 1) {
		validationErrors.push(`${label}.key frame version must be 1`);
	}
	if (!isApplicationOperation(frame.operation)) {
		validationErrors.push(`${label}.key frame operation must be create, replace, or update`);
	} else if (context.operation !== undefined && frame.operation !== context.operation) {
		validationErrors.push(`${label}.key frame operation must match evidence.operation`);
	}
	if (frame.operationVersion !== 1) {
		validationErrors.push(`${label}.key frame operationVersion must be 1`);
	} else if (
		context.operationVersion !== undefined &&
		frame.operationVersion !== context.operationVersion
	) {
		validationErrors.push(
			`${label}.key frame operationVersion must match evidence.operationVersion`,
		);
	}
	if (!isNonEmptyString(frame.targetRecordId)) {
		validationErrors.push(`${label}.key frame targetRecordId must be non-empty`);
	} else if (
		context.targetRecordId !== undefined &&
		frame.targetRecordId !== context.targetRecordId
	) {
		validationErrors.push(`${label}.key frame targetRecordId must match evidence target`);
	}
	try {
		const recordFrame = assertAgenticMemoryRecordFrame(frame.record);
		if (context.recordId !== undefined && recordFrame.record.id !== context.recordId) {
			validationErrors.push(`${label}.key frame record.id must match evidence.recordId`);
		}
		if (context.fragmentId !== undefined && recordFrame.record.fragment.id !== context.fragmentId) {
			validationErrors.push(`${label}.key frame record.fragment.id must match evidence.fragmentId`);
		}
	} catch (error) {
		validationErrors.push(`${label}.key frame record is invalid: ${errorMessage(error)}`);
	}
}

function evidenceConflict(
	a: AgenticMemoryRecordApplicationEvidence,
	b: AgenticMemoryRecordApplicationEvidence,
): boolean {
	if (!evidenceScopesOverlap(a, b)) return false;
	return (
		evidenceCoordinateKey(a) !== evidenceCoordinateKey(b) ||
		a.materialIdentity.key !== b.materialIdentity.key
	);
}

function evidenceScopesOverlap(
	a: AgenticMemoryRecordApplicationEvidence,
	b: AgenticMemoryRecordApplicationEvidence,
): boolean {
	return (
		a.applicationId === undefined ||
		b.applicationId === undefined ||
		a.applicationId === b.applicationId
	);
}

function evidenceExactKey(evidence: AgenticMemoryRecordApplicationEvidence): string {
	return canonicalTupleKey([
		evidence.applicationId ?? "",
		evidence.admissionId,
		evidence.proposalId ?? "",
		evidence.idempotencyKey ?? "",
		evidenceCoordinateKey(evidence),
		evidence.materialIdentity.key,
	]);
}

function evidenceCoordinateKey(evidence: AgenticMemoryRecordApplicationEvidence): string {
	return canonicalTupleKey([
		evidence.operation,
		String(evidence.operationVersion),
		evidence.recordId,
		evidence.fragmentId,
		evidence.targetRecordId ?? evidence.recordId,
	]);
}

function evidenceCursor(
	input: AgenticMemoryRecordApplicationPriorEvidenceCursor,
): AgenticMemoryRecordApplicationPriorEvidenceCursor {
	return Object.freeze({
		evaluation: input.evaluation ?? 0,
		applicationDecisions: input.applicationDecisions,
		appliedDecisions: input.appliedDecisions,
		skippedDecisions: input.skippedDecisions,
		rejectedDecisions: input.rejectedDecisions,
		evidenceFacts: input.evidenceFacts,
		validEvidenceFacts: input.validEvidenceFacts,
		invalidEvidenceFacts: input.invalidEvidenceFacts,
		duplicateEvidenceFacts: input.duplicateEvidenceFacts,
		issues: input.issues,
	});
}

function evidenceStatus(
	cursor: AgenticMemoryRecordApplicationPriorEvidenceCursor,
): AgenticMemoryRecordApplicationEvidenceProjectionStatus {
	const state =
		cursor.issues > 0 && cursor.validEvidenceFacts === 0
			? "error"
			: cursor.issues > 0
				? "partial"
				: cursor.evidenceFacts === 0 && cursor.applicationDecisions === 0
					? "empty"
					: cursor.validEvidenceFacts === 0 &&
							(cursor.skippedDecisions > 0 || cursor.rejectedDecisions > 0)
						? "blocked"
						: "ready";
	return Object.freeze({ state, cursor });
}

function auditEntry(
	action: AgenticMemoryRecordApplicationEvidenceProjectionAuditEntry["action"],
	fields: Omit<AgenticMemoryRecordApplicationEvidenceProjectionAuditEntry, "kind" | "action"> = {},
): AgenticMemoryRecordApplicationEvidenceProjectionAuditEntry {
	return Object.freeze({
		kind: "agentic-memory-record-application-evidence-projection-audit",
		action,
		...fields,
	});
}

function isApplicationOperation(value: unknown): value is AgenticMemoryRecordApplicationOperation {
	return value === "create" || value === "replace" || value === "update";
}

function dataRecordContainerErrors(value: unknown, label: string): readonly string[] {
	if (!isPlainRecord(value)) return [`${label} must be an object when present`];
	const errors: string[] = [];
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) {
		errors.push(`${label} must be a plain data object`);
	}
	if (Object.getOwnPropertySymbols(value).length > 0) {
		errors.push(`${label} must not carry symbol keys`);
	}
	for (const key of Object.getOwnPropertyNames(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) continue;
		if ("get" in descriptor || "set" in descriptor) {
			errors.push(`${label}.${key} must be a data property`);
		}
	}
	return errors;
}

function unexpectedFields(
	value: Record<string, unknown>,
	expected: readonly string[],
): readonly string[] {
	const allowed = new Set(expected);
	return Object.keys(value)
		.filter((key) => !allowed.has(key))
		.sort();
}

function snapshotMetadata(
	value: unknown,
	label: string,
	errors: string[],
): Readonly<Record<string, StrictJsonValue>> | undefined {
	if (value === undefined) return undefined;
	if (!isPlainRecord(value)) {
		errors.push(`${label} must be a strict JSON object`);
		return undefined;
	}
	try {
		return cloneStrictJsonObject(value);
	} catch {
		errors.push(`${label} must be a strict JSON object`);
		return undefined;
	}
}

function snapshotFactRefs(
	value: unknown,
	label: string,
	errors: string[],
): readonly AgenticMemoryFactRef[] | undefined {
	const validationErrors = validateAgenticMemoryFactRefs(value);
	if (validationErrors.length > 0) {
		errors.push(...validationErrors.map((error) => `${label}: ${error}`));
		return undefined;
	}
	return snapshotAgenticMemoryFactRefs(value);
}

function dataIssue(
	code: string,
	message: string,
	fields: Omit<DataIssue, "kind" | "code" | "message" | "source"> = {},
): DataIssue {
	return Object.freeze({
		kind: "issue",
		source: "agentic-memory",
		code,
		message,
		...fields,
	});
}
