import { depLatest } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../../identity.js";
import type { FactId } from "../../patterns/semantic-memory.js";
import { solutionProjection } from "./projection.js";
import {
	cloneStrictJsonObject,
	dataRecordContainerErrors,
	errorMessage,
	forbiddenAgenticMemoryDataFields,
	isNonEmptyString,
	isPlainRecord,
	isStrictJsonObject,
	safeArrayLength,
	snapshotAgenticMemoryFactRefs,
	validateAgenticMemoryFactRefs,
	validateAndProjectRecords,
	validateAndSnapshotRecord,
} from "./shared.js";
import type {
	AgenticMemoryFactRef,
	AgenticMemoryRecord,
	AgenticMemoryRecordApplicationOperation,
	AgenticMemoryRecordCandidateMaterial,
	AgenticMemoryRecordMaterializationAuditEntry,
	AgenticMemoryRecordMaterializationCursor,
	AgenticMemoryRecordMaterializationIntent,
	AgenticMemoryRecordMaterializationProjection,
	AgenticMemoryRecordMaterializationStatusState,
	AgenticMemoryRecordMaterializerBundle,
	AgenticMemoryRecordMaterializerBundleOptions,
	AgenticMemoryRecordProposal,
	StrictJsonValue,
} from "./types.js";

const AGENTIC_MEMORY_RECORD_MATERIALIZER_ID =
	"agentic-memory-record-complete-next-record-materializer";
const AGENTIC_MEMORY_RECORD_MATERIALIZATION_OPERATION_VERSION = 1 as const;
const AGENTIC_MEMORY_RECORD_MATERIALIZATION_OPERATIONS = ["create", "replace", "update"] as const;

interface MaterializerOptions<T> {
	readonly records?: readonly AgenticMemoryRecord<T>[];
	readonly materializerId?: FactId;
	readonly evaluation?: number;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
}

interface ValidatedIntent<T> {
	readonly intent: AgenticMemoryRecordMaterializationIntent<T>;
	readonly candidateMaterial: AgenticMemoryRecordCandidateMaterial<T>;
	readonly proposal: AgenticMemoryRecordProposal<T>;
	readonly material: MaterialComparable<T>;
	readonly applicationMaterial: ApplicationMaterialComparable<T>;
	readonly coordinateKey: string;
	readonly effectiveTargetRecordId: FactId;
}

interface MaterialComparable<T> {
	readonly operation: AgenticMemoryRecordApplicationOperation;
	readonly operationVersion: 1;
	readonly targetRecordId?: FactId;
	readonly record: AgenticMemoryRecord<T>;
	readonly reason?: string;
	readonly idempotencyKey?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly evidenceRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

interface ApplicationMaterialComparable<T> {
	readonly operation: AgenticMemoryRecordApplicationOperation;
	readonly operationVersion: 1;
	readonly targetRecordId: FactId;
	readonly record: AgenticMemoryRecord<T>;
}

/**
 * Materializes D586 complete-next-record change intents into proposal-compatible DATA.
 *
 * The helper validates domain-specific intent facts against current records and
 * emits full `AgenticMemoryRecordProposal` material only. It does not admit,
 * apply, persist, hydrate, commit, mutate live records, or interpret patch/merge
 * semantics.
 *
 * @param intents - Complete-next-record materialization intent DATA.
 * @param opts - Current records, optional evaluation, materializer id, and refs.
 * @returns Candidate material/proposals plus materializer-local status, issues, audit, and cursor.
 * @category solutions
 * @example
 * ```ts
 * import { materializeAgenticMemoryRecordChanges } from "@graphrefly/ts/solutions/agentic-memory";
 * ```
 */
export function materializeAgenticMemoryRecordChanges<T = unknown>(
	intents: unknown,
	opts: MaterializerOptions<T> = {},
): AgenticMemoryRecordMaterializationProjection<T> {
	const validatedOptions = validateMaterializerOptions(opts);
	const materializerId = validatedOptions.materializerId;
	const materializerOpts: MaterializerOptions<T> = {
		...opts,
		materializerId,
		sourceRefs: validatedOptions.sourceRefs,
		policyRefs: validatedOptions.policyRefs,
	};
	const recordProjection = validateAndProjectRecords<T>(opts.records ?? []);
	const recordsById = new Map(recordProjection.records.map((record) => [record.id, record]));
	const issues: DataIssue[] = [
		...recordProjection.errors.map(recordProjectionIssue),
		...validatedOptions.issues,
	];
	const audit: AgenticMemoryRecordMaterializationAuditEntry[] = [];
	let intentsCount = 0;
	let invalidIntents = 0;
	let duplicateIntents = 0;
	let divergentIntents = 0;
	let coordinateConflicts = 0;
	const validated: ValidatedIntent<T>[] = [];

	if (!Array.isArray(intents)) {
		invalidIntents += 1;
		issues.push(
			dataIssue(
				"agentic-memory.materializer.invalid-input",
				"materialization intents input must be an array",
				{ severity: "error" },
			),
		);
	} else {
		const length = safeArrayLength(intents);
		if (length === undefined) {
			invalidIntents += 1;
			issues.push(
				dataIssue(
					"agentic-memory.materializer.invalid-input",
					"materialization intents input length could not be read",
					{ severity: "error" },
				),
			);
		} else {
			intentsCount = length;
			for (let index = 0; index < length; index += 1) {
				try {
					if (!Object.hasOwn(intents, index)) {
						throw new TypeError("materialization intents must be dense");
					}
					const result = validateMaterializationIntent<T>(
						intents[index],
						index,
						recordsById,
						materializerId,
						materializerOpts,
					);
					if (result.intent === undefined) {
						invalidIntents += 1;
						issues.push(...result.issues);
						continue;
					}
					validated.push(result.intent);
				} catch (error) {
					invalidIntents += 1;
					issues.push(
						dataIssue(
							"agentic-memory.materializer.invalid-intent",
							`materialization intent access failed: ${errorMessage(error)}`,
							{ severity: "error", path: [index] },
						),
					);
				}
			}
		}
	}

	const groups = new Map<FactId, ValidatedIntent<T>[]>();
	for (const item of validated) {
		const group = groups.get(item.intent.intentId);
		if (group === undefined) groups.set(item.intent.intentId, [item]);
		else group.push(item);
	}

	const representatives: ValidatedIntent<T>[] = [];
	for (const [intentId, group] of groups) {
		const first = group[0];
		if (first === undefined) continue;
		const divergent = group.some((item) => !deepEqualValue(item.material, first.material));
		if (divergent) {
			divergentIntents += 1;
			issues.push(
				dataIssue(
					"agentic-memory.materializer.duplicate-intent-divergent",
					"duplicate materialization intent id produced divergent material",
					{
						severity: "error",
						subjectId: intentId,
						refs: group.map((item) => item.proposal.proposalId),
					},
				),
			);
			audit.push(
				materializationAudit("divergent-intent", {
					intentId,
					reason: "duplicate intentId with divergent material",
				}),
			);
			continue;
		}
		if (group.length > 1) {
			duplicateIntents += group.length - 1;
			audit.push(
				materializationAudit("duplicate-suppressed", {
					intentId,
					proposalId: first.proposal.proposalId,
					operation: first.intent.operation,
					operationVersion: first.intent.operationVersion,
					targetRecordId: first.intent.targetRecordId ?? first.intent.record.id,
					recordId: first.intent.record.id,
					reason: "duplicate intentId with identical material",
				}),
			);
		}
		representatives.push(first);
	}

	const candidateMaterials: AgenticMemoryRecordCandidateMaterial<T>[] = [];
	const proposals: AgenticMemoryRecordProposal<T>[] = [];
	const coordinateGroups = new Map<string, ValidatedIntent<T>[]>();
	for (const item of representatives) {
		const group = coordinateGroups.get(item.coordinateKey);
		if (group === undefined) coordinateGroups.set(item.coordinateKey, [item]);
		else group.push(item);
	}
	for (const [coordinateKey, group] of coordinateGroups) {
		const first = group[0];
		if (first === undefined) continue;
		const coordinateDivergent = group.some(
			(item) => !deepEqualValue(item.applicationMaterial, first.applicationMaterial),
		);
		if (coordinateDivergent) {
			coordinateConflicts += 1;
			issues.push(
				dataIssue(
					"agentic-memory.materializer.coordinate-conflict",
					"materialization intents produced divergent material for the same application coordinate",
					{
						severity: "error",
						subjectId: first.effectiveTargetRecordId,
						refs: group.map((item) => item.proposal.proposalId),
					},
				),
			);
			audit.push(
				materializationAudit("coordinate-conflict", {
					intentId: first.intent.intentId,
					operation: first.intent.operation,
					operationVersion: first.intent.operationVersion,
					targetRecordId: first.effectiveTargetRecordId,
					recordId: first.intent.record.id,
					reason: `same application coordinate with divergent material: ${coordinateKey}`,
				}),
			);
			continue;
		}
		for (const item of group) {
			candidateMaterials.push(item.candidateMaterial);
			proposals.push(item.proposal);
			audit.push(
				materializationAudit("proposal-materialized", {
					intentId: item.intent.intentId,
					proposalId: item.proposal.proposalId,
					operation: item.intent.operation,
					operationVersion: item.intent.operationVersion,
					targetRecordId: item.effectiveTargetRecordId,
					recordId: item.intent.record.id,
					sourceRefs: item.proposal.sourceRefs,
					policyRefs: item.proposal.policyRefs,
					evidenceRefs: item.proposal.evidenceRefs,
				}),
			);
		}
	}
	for (const issue of issues) {
		audit.push(materializationAudit("issue-recorded", { reason: issue.code }));
	}

	const cursor: AgenticMemoryRecordMaterializationCursor = Object.freeze({
		evaluation: opts.evaluation ?? 0,
		records: safeInputLength(opts.records),
		validRecords: recordProjection.records.length,
		invalidRecords: recordProjection.invalidRecordIndexes.size,
		intents: intentsCount,
		validIntents: validated.length,
		invalidIntents,
		duplicateIntents,
		divergentIntents,
		coordinateConflicts,
		candidateMaterials: candidateMaterials.length,
		proposals: proposals.length,
		issues: issues.length,
	});
	return Object.freeze({
		kind: "agentic-memory-record-materialization-projection",
		candidateMaterials: Object.freeze(candidateMaterials),
		proposals: Object.freeze(proposals),
		status: Object.freeze({ state: materializationStatus(cursor), cursor }),
		issues: Object.freeze(issues),
		audit: Object.freeze(audit),
		cursor,
	});
}

/**
 * Creates a graph-visible D586 complete-next-record materializer bundle.
 *
 * The bundle turns current records plus materialization intents into ordinary
 * proposal DATA. It does not wire those proposals into admission/application,
 * storage, hydration, durable commit, or same-evaluation evidence feedback.
 *
 * @param graph - Graph that owns the created nodes.
 * @param opts - Records and intents input nodes plus optional materializer id/name.
 * @returns Projection node plus proposal/candidate/status/issues/audit/cursor nodes.
 * @category solutions
 */
export function agenticMemoryRecordMaterializerBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryRecordMaterializerBundleOptions<T>,
): AgenticMemoryRecordMaterializerBundle<T> {
	const name = opts.name ?? "agenticMemoryRecordMaterializer";
	const projection = graph.node<AgenticMemoryRecordMaterializationProjection<T>>(
		[opts.records, opts.intents],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					materializeAgenticMemoryRecordChanges<T>(depLatest(ctx, 1), {
						records: depLatest(ctx, 0) as readonly AgenticMemoryRecord<T>[] | undefined,
						materializerId: opts.materializerId,
						evaluation: state.evaluation,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryRecordMaterializer",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { records: opts.records, intents: opts.intents },
		projection,
		proposals: solutionProjection(
			graph,
			projection,
			`${name}/proposals`,
			"agenticMemoryRecordMaterializerProposals",
			(fact) => fact.proposals,
		),
		candidateMaterials: solutionProjection(
			graph,
			projection,
			`${name}/candidateMaterials`,
			"agenticMemoryRecordMaterializerCandidateMaterials",
			(fact) => fact.candidateMaterials,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryRecordMaterializerStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryRecordMaterializerIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryRecordMaterializerAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryRecordMaterializerCursor",
			(fact) => fact.cursor,
		),
	};
}

function validateMaterializationIntent<T>(
	value: unknown,
	index: number,
	recordsById: ReadonlyMap<FactId, AgenticMemoryRecord<T>>,
	materializerId: FactId,
	opts: MaterializerOptions<T>,
): {
	readonly intent?: ValidatedIntent<T>;
	readonly issues: readonly DataIssue[];
} {
	if (!isPlainRecord(value)) {
		return {
			issues: [
				dataIssue(
					"agentic-memory.materializer.invalid-intent",
					"materialization intent must be an object",
					{ severity: "error", path: [index] },
				),
			],
		};
	}
	const validationErrors = [
		...dataRecordContainerErrors(value, "intent"),
		...forbiddenAgenticMemoryDataFields(value, "intent"),
		...unexpectedFields(value, [
			"kind",
			"intentId",
			"operation",
			"operationVersion",
			"record",
			"targetRecordId",
			"reason",
			"idempotencyKey",
			"correlationId",
			"causationId",
			"sourceRefs",
			"policyRefs",
			"evidenceRefs",
			"metadata",
		]).map((field) => `intent.${field} is not part of materialization intent`),
	];
	if (value.kind !== "agentic-memory-record-materialization-intent") {
		validationErrors.push("intent.kind must be agentic-memory-record-materialization-intent");
	}
	const intentId = isNonEmptyString(value.intentId) ? value.intentId : undefined;
	if (intentId === undefined) validationErrors.push("intent.intentId must be non-empty");
	const operation = isMaterializationOperation(value.operation) ? value.operation : undefined;
	if (operation === undefined) {
		validationErrors.push("intent.operation must be create, replace, or update");
	}
	if (value.operationVersion !== AGENTIC_MEMORY_RECORD_MATERIALIZATION_OPERATION_VERSION) {
		validationErrors.push("intent.operationVersion must be 1");
	}
	if (value.targetRecordId !== undefined && !isNonEmptyString(value.targetRecordId)) {
		validationErrors.push("intent.targetRecordId must be non-empty when present");
	}
	for (const field of ["reason", "idempotencyKey", "correlationId", "causationId"] as const) {
		if (value[field] !== undefined && typeof value[field] !== "string") {
			validationErrors.push(`intent.${field} must be a string when present`);
		}
	}
	const sourceRefs = snapshotRefs(value.sourceRefs, "intent.sourceRefs", validationErrors);
	const policyRefs = snapshotRefs(value.policyRefs, "intent.policyRefs", validationErrors);
	const evidenceRefs = snapshotRefs(value.evidenceRefs, "intent.evidenceRefs", validationErrors);
	const metadata = snapshotMetadata(value.metadata, "intent.metadata", validationErrors);
	const materialSourceRefs = mergeRefs([...(opts.sourceRefs ?? []), ...sourceRefs]);
	const materialPolicyRefs = mergeRefs([...(opts.policyRefs ?? []), ...policyRefs]);
	const recordResult = validateAndSnapshotRecord<T>(value.record, index);
	if (recordResult.record === undefined || recordResult.errors.length > 0) {
		validationErrors.push(
			...recordResult.errors.flatMap((error) =>
				(error.validationErrors ?? [error.message]).map((message) => `intent.record: ${message}`),
			),
		);
	}
	const record = recordResult.record;
	const targetRecordId = isNonEmptyString(value.targetRecordId) ? value.targetRecordId : undefined;
	const currentRecord = targetRecordId === undefined ? undefined : recordsById.get(targetRecordId);
	if (operation === "create" && targetRecordId !== undefined && record?.id !== targetRecordId) {
		validationErrors.push("create targetRecordId must be absent or equal to record.id");
	}
	if ((operation === "replace" || operation === "update") && targetRecordId === undefined) {
		validationErrors.push(`${operation} targetRecordId is required`);
	}
	if ((operation === "replace" || operation === "update") && targetRecordId !== undefined) {
		if (currentRecord === undefined) {
			validationErrors.push(`${operation} targetRecordId must reference a current record`);
		}
		if (record !== undefined && record.id !== targetRecordId) {
			validationErrors.push(`${operation} record.id must equal targetRecordId`);
		}
		if (
			currentRecord !== undefined &&
			record !== undefined &&
			!hasExistingTargetLineage(record, currentRecord, [
				...(materialSourceRefs ?? []),
				...evidenceRefs,
			])
		) {
			validationErrors.push(
				`${operation} requires explicit lineage to the prior record or fragment`,
			);
		}
	}
	if (
		validationErrors.length > 0 ||
		intentId === undefined ||
		operation === undefined ||
		record === undefined
	) {
		return {
			issues: [
				dataIssue(
					"agentic-memory.materializer.invalid-intent",
					"materialization intent is invalid",
					{
						severity: "error",
						subjectId: intentId,
						path: [index],
						refs: validationErrors,
					},
				),
			],
		};
	}
	const effectiveTargetRecordId = targetRecordId ?? record.id;
	const coordinateKey = materializationCoordinateKey(
		operation,
		AGENTIC_MEMORY_RECORD_MATERIALIZATION_OPERATION_VERSION,
		effectiveTargetRecordId,
	);
	const candidateMaterial: AgenticMemoryRecordCandidateMaterial<T> = Object.freeze({
		kind: "agentic-memory-record-candidate-material",
		operation,
		operationVersion: AGENTIC_MEMORY_RECORD_MATERIALIZATION_OPERATION_VERSION,
		record,
		...(targetRecordId === undefined ? {} : { targetRecordId }),
		...(materialSourceRefs === undefined ? {} : { sourceRefs: materialSourceRefs }),
		...(materialPolicyRefs === undefined ? {} : { policyRefs: materialPolicyRefs }),
		...(evidenceRefs.length === 0 ? {} : { evidenceRefs }),
		...(metadata === undefined ? {} : { metadata }),
	});
	const proposalId = compoundTupleKey("agentic-memory-record-proposal", [
		materializerId,
		intentId,
		operation,
		effectiveTargetRecordId,
		record.id,
	]);
	const proposal: AgenticMemoryRecordProposal<T> = Object.freeze({
		kind: "agentic-memory-record-proposal",
		proposalId,
		operation,
		operationVersion: AGENTIC_MEMORY_RECORD_MATERIALIZATION_OPERATION_VERSION,
		candidateMaterial,
		...(targetRecordId === undefined ? {} : { targetRecordId }),
		...(value.reason === undefined ? {} : { reason: value.reason as string }),
		proposalStatus: "materialized",
		...(materialSourceRefs === undefined ? {} : { sourceRefs: materialSourceRefs }),
		...(materialPolicyRefs === undefined ? {} : { policyRefs: materialPolicyRefs }),
		...(evidenceRefs.length === 0 ? {} : { evidenceRefs }),
		...(value.idempotencyKey === undefined
			? {}
			: { idempotencyKey: value.idempotencyKey as string }),
		...(value.correlationId === undefined ? {} : { correlationId: value.correlationId as string }),
		causationId: value.causationId === undefined ? intentId : (value.causationId as string),
		...(metadata === undefined ? {} : { metadata }),
	});
	const intent: AgenticMemoryRecordMaterializationIntent<T> = Object.freeze({
		kind: "agentic-memory-record-materialization-intent",
		intentId,
		operation,
		operationVersion: AGENTIC_MEMORY_RECORD_MATERIALIZATION_OPERATION_VERSION,
		record,
		...(targetRecordId === undefined ? {} : { targetRecordId }),
		...(value.reason === undefined ? {} : { reason: value.reason as string }),
		...(value.idempotencyKey === undefined
			? {}
			: { idempotencyKey: value.idempotencyKey as string }),
		...(value.correlationId === undefined ? {} : { correlationId: value.correlationId as string }),
		...(value.causationId === undefined ? {} : { causationId: value.causationId as string }),
		...(sourceRefs.length === 0 ? {} : { sourceRefs }),
		...(policyRefs.length === 0 ? {} : { policyRefs }),
		...(evidenceRefs.length === 0 ? {} : { evidenceRefs }),
		...(metadata === undefined ? {} : { metadata }),
	});
	return {
		intent: {
			intent,
			candidateMaterial,
			proposal,
			applicationMaterial: Object.freeze({
				operation,
				operationVersion: AGENTIC_MEMORY_RECORD_MATERIALIZATION_OPERATION_VERSION,
				targetRecordId: effectiveTargetRecordId,
				record,
			}),
			coordinateKey,
			effectiveTargetRecordId,
			material: Object.freeze({
				operation,
				operationVersion: AGENTIC_MEMORY_RECORD_MATERIALIZATION_OPERATION_VERSION,
				...(targetRecordId === undefined ? {} : { targetRecordId }),
				record,
				...(value.reason === undefined ? {} : { reason: value.reason as string }),
				...(value.idempotencyKey === undefined
					? {}
					: { idempotencyKey: value.idempotencyKey as string }),
				...(value.correlationId === undefined
					? {}
					: { correlationId: value.correlationId as string }),
				causationId: value.causationId === undefined ? intentId : (value.causationId as string),
				...(materialSourceRefs === undefined ? {} : { sourceRefs: materialSourceRefs }),
				...(materialPolicyRefs === undefined ? {} : { policyRefs: materialPolicyRefs }),
				...(evidenceRefs.length === 0 ? {} : { evidenceRefs }),
				...(metadata === undefined ? {} : { metadata }),
			}),
		},
		issues: [],
	};
}

function validateMaterializerOptions<T>(opts: MaterializerOptions<T>): {
	readonly materializerId: FactId;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly issues: readonly DataIssue[];
} {
	const refs: string[] = [];
	const sourceRefs = snapshotRefs(opts.sourceRefs, "options.sourceRefs", refs);
	const policyRefs = snapshotRefs(opts.policyRefs, "options.policyRefs", refs);
	if (opts.materializerId !== undefined && !isNonEmptyString(opts.materializerId)) {
		refs.push("options.materializerId must be non-empty when present");
	}
	const materializerId = isNonEmptyString(opts.materializerId)
		? opts.materializerId
		: AGENTIC_MEMORY_RECORD_MATERIALIZER_ID;
	return {
		materializerId,
		...(sourceRefs.length === 0 ? {} : { sourceRefs }),
		...(policyRefs.length === 0 ? {} : { policyRefs }),
		issues:
			refs.length === 0
				? Object.freeze([])
				: Object.freeze([
						dataIssue(
							"agentic-memory.materializer.invalid-options",
							"materializer options are invalid",
							{ severity: "error", refs },
						),
					]),
	};
}

function recordProjectionIssue(
	error: ReturnType<typeof validateAndProjectRecords>["errors"][number],
): DataIssue {
	return dataIssue("agentic-memory.materializer.invalid-record", error.message, {
		severity: "error",
		subjectId: error.recordId,
		refs: error.validationErrors,
	});
}

function snapshotRefs(
	value: unknown,
	label: string,
	errors: string[],
): readonly AgenticMemoryFactRef[] {
	if (value === undefined) return Object.freeze([]);
	const refErrors = validateAgenticMemoryFactRefs(value);
	if (refErrors.length > 0) {
		errors.push(...refErrors.map((error) => `${label}: ${error}`));
		return Object.freeze([]);
	}
	return snapshotAgenticMemoryFactRefs(value);
}

function snapshotMetadata(
	value: unknown,
	label: string,
	errors: string[],
): Readonly<Record<string, StrictJsonValue>> | undefined {
	if (value === undefined) return undefined;
	if (!isPlainRecord(value) || !isStrictJsonObject(value)) {
		errors.push(`${label} must be a strict JSON object`);
		return undefined;
	}
	for (const forbidden of forbiddenAgenticMemoryDataFields(value, label)) {
		errors.push(forbidden);
	}
	return cloneStrictJsonObject(value);
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

function isMaterializationOperation(
	value: unknown,
): value is AgenticMemoryRecordApplicationOperation {
	return AGENTIC_MEMORY_RECORD_MATERIALIZATION_OPERATIONS.some((operation) => operation === value);
}

function hasExistingTargetLineage<T>(
	record: AgenticMemoryRecord<T>,
	prior: AgenticMemoryRecord<T>,
	refs: readonly AgenticMemoryFactRef[],
): boolean {
	if (record.fragment.parentFragmentId === prior.fragment.id) return true;
	if (
		record.fragment.sources.some((source) => source === prior.id || source === prior.fragment.id)
	) {
		return true;
	}
	return refs.some((ref) => {
		const kind = ref.kind.toLowerCase();
		return (
			(ref.id === prior.id && kind.includes("record")) ||
			(ref.id === prior.fragment.id && kind.includes("fragment"))
		);
	});
}

function mergeRefs(
	refs: readonly AgenticMemoryFactRef[],
): readonly AgenticMemoryFactRef[] | undefined {
	if (refs.length === 0) return undefined;
	const seen = new Set<string>();
	const out: AgenticMemoryFactRef[] = [];
	for (const ref of refs) {
		const key = canonicalTupleKey([ref.kind, ref.id]);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(ref);
	}
	return Object.freeze(out);
}

function materializationCoordinateKey(
	operation: AgenticMemoryRecordApplicationOperation,
	operationVersion: 1,
	targetRecordId: FactId,
): string {
	return canonicalTupleKey([
		"agentic-memory-record-materialization-coordinate",
		operation,
		String(operationVersion),
		targetRecordId,
	]);
}

function materializationAudit(
	action: AgenticMemoryRecordMaterializationAuditEntry["action"],
	patch: Omit<AgenticMemoryRecordMaterializationAuditEntry, "kind" | "action"> = {},
): AgenticMemoryRecordMaterializationAuditEntry {
	return Object.freeze({
		kind: "agentic-memory-record-materialization-audit",
		action,
		...patch,
	});
}

function materializationStatus(
	cursor: AgenticMemoryRecordMaterializationCursor,
): AgenticMemoryRecordMaterializationStatusState {
	if (cursor.issues > 0 && cursor.proposals === 0) return "error";
	if (cursor.issues > 0) return "partial";
	if (cursor.proposals > 0) return "ready";
	return cursor.intents > 0 ? "blocked" : "empty";
}

function safeInputLength(value: unknown): number {
	if (!Array.isArray(value)) return 0;
	return safeArrayLength(value) ?? 0;
}

function deepEqualValue(a: unknown, b: unknown): boolean {
	return deepEqualValueInner(a, b, new WeakMap<object, WeakSet<object>>());
}

function deepEqualValueInner(
	a: unknown,
	b: unknown,
	seen: WeakMap<object, WeakSet<object>>,
): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
		return false;
	}
	let seenForA = seen.get(a);
	if (seenForA?.has(b)) return true;
	if (seenForA === undefined) {
		seenForA = new WeakSet<object>();
		seen.set(a, seenForA);
	}
	seenForA.add(b);
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let index = 0; index < a.length; index += 1) {
			if (!deepEqualValueInner(a[index], b[index], seen)) return false;
		}
		return true;
	}
	const aRecord = a as Record<string, unknown>;
	const bRecord = b as Record<string, unknown>;
	const aKeys = Object.keys(aRecord).sort();
	const bKeys = Object.keys(bRecord).sort();
	if (aKeys.length !== bKeys.length) return false;
	for (let index = 0; index < aKeys.length; index += 1) {
		const key = aKeys[index] as string;
		if (key !== bKeys[index]) return false;
		if (!deepEqualValueInner(aRecord[key], bRecord[key], seen)) return false;
	}
	return true;
}

function dataIssue(
	code: string,
	message: string,
	opts: {
		readonly severity?: DataIssue["severity"];
		readonly subjectId?: string;
		readonly path?: readonly (string | number)[];
		readonly refs?: readonly string[];
	} = {},
): DataIssue {
	return Object.freeze({
		kind: "issue",
		code,
		message,
		source: "agentic-memory",
		...opts,
	});
}
