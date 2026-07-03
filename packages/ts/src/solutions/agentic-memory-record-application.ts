import { depLatest } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type { FactId } from "../patterns/semantic-memory.js";
import { solutionProjection } from "./agentic-memory-projection.js";
import {
	cloneStrictJsonObject,
	errorMessage,
	forbiddenAgenticMemoryDataFields,
	isNonEmptyString,
	isPlainRecord,
	safeArrayLength,
	snapshotAgenticMemoryFactRefs,
	validateAgenticMemoryContextAttribution,
	validateAgenticMemoryFactRefs,
	validateAndProjectRecords,
	validateAndSnapshotRecord,
} from "./agentic-memory-shared.js";
import type {
	AgenticMemoryFactRef,
	AgenticMemoryRecord,
	AgenticMemoryRecordAdmission,
	AgenticMemoryRecordApplicationAuditEntry,
	AgenticMemoryRecordApplicationBundle,
	AgenticMemoryRecordApplicationBundleOptions,
	AgenticMemoryRecordApplicationCursor,
	AgenticMemoryRecordApplicationDecision,
	AgenticMemoryRecordApplicationEvidence,
	AgenticMemoryRecordApplicationOptions,
	AgenticMemoryRecordApplicationPolicy,
	AgenticMemoryRecordApplicationReasonCode,
	AgenticMemoryRecordApplicationSnapshot,
	AgenticMemoryRecordApplicationStatus,
	AgenticMemoryRecordApplicationStatusState,
	AgenticMemoryRecordCandidateMaterial,
	StrictJsonValue,
} from "./agentic-memory-types.js";

interface ValidatedPolicy {
	readonly policy?: AgenticMemoryRecordApplicationPolicy;
	readonly issues: readonly DataIssue[];
	readonly invalidPolicies: number;
}

interface ValidatedAdmissions<T> {
	readonly admissions: readonly AgenticMemoryRecordAdmission<T>[];
	readonly invalidAdmissions: number;
	readonly issues: readonly DataIssue[];
}

interface ValidatedHistory {
	readonly entries: readonly AgenticMemoryRecordApplicationEvidence[];
	readonly invalidEntries: number;
	readonly issues: readonly DataIssue[];
}

interface EvidenceIndex {
	readonly byAdmissionId: ReadonlyMap<FactId, readonly AgenticMemoryRecordApplicationEvidence[]>;
	readonly byIdempotencyKey: ReadonlyMap<string, readonly AgenticMemoryRecordApplicationEvidence[]>;
	readonly issues: readonly DataIssue[];
}

export function agenticMemoryRecordApplicationBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryRecordApplicationBundleOptions<T>,
): AgenticMemoryRecordApplicationBundle<T> {
	const name = opts.name ?? "agenticMemoryRecordApplication";
	const deps =
		opts.history === undefined
			? [opts.records, opts.admissions, opts.policy]
			: [opts.records, opts.admissions, opts.policy, opts.history];
	const projection = graph.node<AgenticMemoryRecordApplicationSnapshot<T>>(
		deps,
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const snapshot = applyAgenticMemoryRecordAdmissions<T>(depLatest(ctx, 1), depLatest(ctx, 2), {
				records: depLatest(ctx, 0) as readonly AgenticMemoryRecord<T>[] | undefined,
				history:
					opts.history === undefined
						? undefined
						: (depLatest(ctx, 3) as AgenticMemoryRecordApplicationOptions<T>["history"]),
				evaluation: state.evaluation,
			});
			ctx.state.set(state);
			ctx.down([["DATA", snapshot]]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryRecordApplication",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: {
			records: opts.records,
			admissions: opts.admissions,
			policy: opts.policy,
			...(opts.history === undefined ? {} : { history: opts.history }),
		},
		projection,
		records: solutionProjection(
			graph,
			projection,
			`${name}/records`,
			"agenticMemoryRecordApplicationRecords",
			(fact) => fact.records,
		),
		appliedRecords: solutionProjection(
			graph,
			projection,
			`${name}/appliedRecords`,
			"agenticMemoryRecordApplicationAppliedRecords",
			(fact) => fact.appliedRecords,
		),
		applicationDecisions: solutionProjection(
			graph,
			projection,
			`${name}/applicationDecisions`,
			"agenticMemoryRecordApplicationDecisions",
			(fact) => fact.applicationDecisions,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryRecordApplicationStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryRecordApplicationIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryRecordApplicationAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryRecordApplicationCursor",
			(fact) => fact.cursor,
		),
	};
}

export function applyAgenticMemoryRecordAdmissions<T = unknown>(
	admissions: unknown,
	policy: unknown,
	opts: AgenticMemoryRecordApplicationOptions<T> = {},
): AgenticMemoryRecordApplicationSnapshot<T> {
	const recordProjection = validateAndProjectRecords<T>(opts.records ?? []);
	const validatedPolicy = safeValidateApplicationPolicy(policy);
	const validatedHistory = validateApplicationHistory(opts.history);
	const validatedAdmissions = validateApplicationAdmissions<T>(admissions);
	const baseIssues = [
		...recordProjection.errors.map(recordProjectionIssue),
		...validatedPolicy.issues,
		...validatedHistory.issues,
		...validatedAdmissions.issues,
	];
	const historyIndex = buildEvidenceIndex(validatedHistory.entries);
	const issues: DataIssue[] = [...baseIssues, ...historyIndex.issues];
	const appliedRecords: AgenticMemoryRecord<T>[] = [];
	const applicationDecisions: AgenticMemoryRecordApplicationDecision<T>[] = [];
	const audit: AgenticMemoryRecordApplicationAuditEntry[] = [];
	const nextRecords: AgenticMemoryRecord<T>[] = [...recordProjection.records];
	const currentRecordIds = new Set(nextRecords.map((record) => record.id));
	const currentFragmentIds = new Set(nextRecords.map((record) => record.fragment.id));
	const evaluationEvidenceByAdmissionId = new Map<FactId, AgenticMemoryRecordApplicationEvidence>();
	const evaluationEvidenceByIdempotencyKey = new Map<
		string,
		AgenticMemoryRecordApplicationEvidence
	>();

	if (validatedPolicy.policy !== undefined) {
		for (let index = 0; index < validatedAdmissions.admissions.length; index += 1) {
			const admission = validatedAdmissions.admissions[index] as AgenticMemoryRecordAdmission<T>;
			const decision = decideApplication(
				admission,
				validatedPolicy.policy,
				index,
				currentRecordIds,
				currentFragmentIds,
				historyIndex,
				evaluationEvidenceByAdmissionId,
				evaluationEvidenceByIdempotencyKey,
			);
			applicationDecisions.push(decision.decision);
			audit.push(applicationAudit(decision.decision));
			issues.push(...decision.issues);
			if (decision.decision.state !== "applied" || decision.decision.record === undefined) {
				continue;
			}
			const evidence = evidenceFromDecision(decision.decision);
			if (!evaluationEvidenceByAdmissionId.has(evidence.admissionId)) {
				evaluationEvidenceByAdmissionId.set(evidence.admissionId, evidence);
			}
			if (
				evidence.idempotencyKey !== undefined &&
				!evaluationEvidenceByIdempotencyKey.has(evidence.idempotencyKey)
			) {
				evaluationEvidenceByIdempotencyKey.set(evidence.idempotencyKey, evidence);
			}
			appliedRecords.push(decision.decision.record);
			nextRecords.push(decision.decision.record);
			currentRecordIds.add(decision.decision.record.id);
			currentFragmentIds.add(decision.decision.record.fragment.id);
		}
	}

	const cursor: AgenticMemoryRecordApplicationCursor = Object.freeze({
		evaluation: opts.evaluation ?? 0,
		records: safeInputLength(opts.records),
		validRecords: recordProjection.records.length,
		invalidRecords: recordProjection.invalidRecordIndexes.size,
		admissions: safeInputLength(admissions),
		validAdmissions: validatedAdmissions.admissions.length,
		invalidAdmissions: validatedAdmissions.invalidAdmissions,
		historyEntries: validatedHistory.entries.length + validatedHistory.invalidEntries,
		invalidHistoryEntries: validatedHistory.invalidEntries,
		applied: appliedRecords.length,
		skipped: applicationDecisions.filter((decision) => decision.state === "skipped").length,
		rejected: applicationDecisions.filter((decision) => decision.state === "rejected").length,
		issues: issues.length,
	});
	const frozenIssues = Object.freeze(issues.map((issue) => Object.freeze(issue)));
	const status: AgenticMemoryRecordApplicationStatus = Object.freeze({
		state: applicationStatus(cursor),
		cursor,
	});
	return Object.freeze({
		records: Object.freeze(nextRecords),
		appliedRecords: Object.freeze(appliedRecords),
		applicationDecisions: Object.freeze(applicationDecisions),
		status,
		issues: frozenIssues,
		audit: Object.freeze(audit),
		cursor,
	});
}

function decideApplication<T>(
	admission: AgenticMemoryRecordAdmission<T>,
	policy: AgenticMemoryRecordApplicationPolicy,
	index: number,
	currentRecordIds: ReadonlySet<FactId>,
	currentFragmentIds: ReadonlySet<FactId>,
	historyIndex: EvidenceIndex,
	evaluationEvidenceByAdmissionId: ReadonlyMap<FactId, AgenticMemoryRecordApplicationEvidence>,
	evaluationEvidenceByIdempotencyKey: ReadonlyMap<string, AgenticMemoryRecordApplicationEvidence>,
): {
	readonly decision: AgenticMemoryRecordApplicationDecision<T>;
	readonly issues: readonly DataIssue[];
} {
	const applicationId = compoundTupleKey("agentic-memory-record-application", [
		policy.policyId,
		admission.admissionId,
	]);
	const candidate = admission.candidateMaterial;
	const record = candidate.record;
	const targetRecordId = admission.targetRecordId ?? candidate.targetRecordId;
	const effectiveTargetRecordId = targetRecordId ?? record.id;
	const sourceRefs = mergeRefs([
		...(candidate.sourceRefs ?? []),
		...(admission.sourceRefs ?? []),
		...(policy.sourceRefs ?? []),
	]);
	const policyRefs = mergeRefs([
		...(candidate.policyRefs ?? []),
		...(admission.policyRefs ?? []),
		{ kind: "agentic-memory-record-application-policy", id: policy.policyId },
		...(policy.policyRefs ?? []),
	]);
	const evidenceRefs = mergeRefs([
		...(candidate.evidenceRefs ?? []),
		...(admission.evidenceRefs ?? []),
	]);
	const common = {
		kind: "agentic-memory-record-application-decision" as const,
		applicationId,
		admissionId: admission.admissionId,
		proposalId: admission.proposalId,
		candidateMaterial: candidate,
		...(targetRecordId === undefined ? {} : { targetRecordId }),
		...(admission.idempotencyKey === undefined ? {} : { idempotencyKey: admission.idempotencyKey }),
		...(sourceRefs === undefined ? {} : { sourceRefs }),
		...(policyRefs === undefined ? {} : { policyRefs }),
		...(evidenceRefs === undefined ? {} : { evidenceRefs }),
	};
	if (admission.state !== "admitted") {
		return {
			decision: freezeDecision({
				...common,
				state: "skipped",
				reasonCode: "skipped-non-admitted",
				reason: `admission state is ${admission.state}`,
			}),
			issues: [],
		};
	}
	const materialKey = applicationMaterialKey({
		recordId: record.id,
		fragmentId: record.fragment.id,
		targetRecordId: effectiveTargetRecordId,
	});
	const admissionEvidence = [
		...scopedEvidence(historyIndex.byAdmissionId.get(admission.admissionId), applicationId),
		evaluationEvidenceByAdmissionId.get(admission.admissionId),
	].filter((evidence) => evidence !== undefined);
	const idempotencyEvidence =
		admission.idempotencyKey === undefined
			? []
			: [
					...scopedEvidence(
						historyIndex.byIdempotencyKey.get(admission.idempotencyKey),
						applicationId,
					),
					evaluationEvidenceByIdempotencyKey.get(admission.idempotencyKey),
				].filter((evidence) => evidence !== undefined);
	const conflictingEvidence = [...admissionEvidence, ...idempotencyEvidence].find(
		(evidence) => evidenceMaterialKey(evidence) !== materialKey,
	);
	if (conflictingEvidence !== undefined) {
		return rejectedDecision(common, "idempotency-conflict", "application evidence conflicts", {
			severity: "error",
			subjectId: admission.admissionId,
			path: [index],
			refs: [
				...(admission.idempotencyKey === undefined ? [] : [admission.idempotencyKey]),
				conflictingEvidence.admissionId,
			],
		});
	}
	const matchingEvidence = [...admissionEvidence, ...idempotencyEvidence].find(
		(evidence) => evidenceMaterialKey(evidence) === materialKey,
	);
	if (matchingEvidence !== undefined) {
		return {
			decision: freezeDecision({
				...common,
				state: "skipped",
				reasonCode: "already-applied",
				reason: "matching graph-visible application evidence already exists",
			}),
			issues: [],
		};
	}
	if (targetRecordId !== undefined && targetRecordId !== record.id) {
		return rejectedDecision(
			common,
			"target-record-id-mismatch",
			"create-only application does not support update/replace targetRecordId",
			{
				severity: "error",
				subjectId: admission.admissionId,
				path: [index, "targetRecordId"],
				refs: [targetRecordId, record.id],
			},
		);
	}
	if (currentRecordIds.has(record.id)) {
		return rejectedDecision(common, "record-id-conflict", "candidate record id already exists", {
			severity: "error",
			subjectId: admission.admissionId,
			path: [index, "candidateMaterial", "record", "id"],
			refs: [record.id],
		});
	}
	if (currentFragmentIds.has(record.fragment.id)) {
		return rejectedDecision(
			common,
			"fragment-id-conflict",
			"candidate fragment id already exists",
			{
				severity: "error",
				subjectId: admission.admissionId,
				path: [index, "candidateMaterial", "record", "fragment", "id"],
				refs: [record.fragment.id],
			},
		);
	}
	return {
		decision: freezeDecision({
			...common,
			state: "applied",
			reasonCode: "applied-create",
			reason: admission.reason ?? `policy:${policy.policyId}`,
			record,
		}),
		issues: [],
	};
}

function rejectedDecision<T>(
	common: Omit<
		AgenticMemoryRecordApplicationDecision<T>,
		"kind" | "state" | "reasonCode" | "reason"
	> & { readonly kind: "agentic-memory-record-application-decision" },
	reasonCode: AgenticMemoryRecordApplicationReasonCode,
	reason: string,
	issue: Omit<DataIssue, "kind" | "code" | "message" | "source">,
): {
	readonly decision: AgenticMemoryRecordApplicationDecision<T>;
	readonly issues: readonly DataIssue[];
} {
	return {
		decision: freezeDecision({
			...common,
			state: "rejected",
			reasonCode,
			reason,
		}),
		issues: [
			dataIssue(`agentic-memory.application.${reasonCode}`, reason, {
				...issue,
			}),
		],
	};
}

function validateApplicationAdmissions<T>(value: unknown): ValidatedAdmissions<T> {
	const admissions: AgenticMemoryRecordAdmission<T>[] = [];
	const issues: DataIssue[] = [];
	let invalidAdmissions = 0;
	if (!Array.isArray(value)) {
		return {
			admissions,
			invalidAdmissions: 1,
			issues: [
				dataIssue(
					"agentic-memory.application.invalid-admissions-input",
					"admissions input must be an array",
					{
						severity: "error",
					},
				),
			],
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			admissions,
			invalidAdmissions: 1,
			issues: [
				dataIssue(
					"agentic-memory.application.invalid-admissions-input",
					"admissions input length could not be read",
					{ severity: "error" },
				),
			],
		};
	}
	for (let index = 0; index < length; index += 1) {
		try {
			if (!Object.hasOwn(value, index)) throw new TypeError("admission array must be dense");
			const validation = validateApplicationAdmission<T>(value[index], index);
			if (validation.admission === undefined) {
				invalidAdmissions += 1;
				issues.push(...validation.issues);
				continue;
			}
			admissions.push(validation.admission);
		} catch (error) {
			invalidAdmissions += 1;
			issues.push(
				dataIssue(
					"agentic-memory.application.invalid-admission",
					`admission access failed: ${errorMessage(error)}`,
					{ severity: "error", path: [index] },
				),
			);
		}
	}
	return {
		admissions: Object.freeze(admissions),
		invalidAdmissions,
		issues: Object.freeze(issues),
	};
}

function validateApplicationAdmission<T>(
	value: unknown,
	index: number,
): {
	readonly admission?: AgenticMemoryRecordAdmission<T>;
	readonly issues: readonly DataIssue[];
} {
	if (!isPlainRecord(value)) {
		return {
			issues: [
				dataIssue("agentic-memory.application.invalid-admission", "admission must be an object", {
					severity: "error",
					path: [index],
				}),
			],
		};
	}
	const validationErrors = [
		...dataRecordContainerErrors(value, "admission"),
		...forbiddenAgenticMemoryDataFields(value, "admission"),
	];
	if (value.kind !== "agentic-memory-record-admission") {
		validationErrors.push("admission.kind must be agentic-memory-record-admission");
	}
	const admissionId = isNonEmptyString(value.admissionId) ? value.admissionId : undefined;
	const proposalId = isNonEmptyString(value.proposalId) ? value.proposalId : undefined;
	if (admissionId === undefined) validationErrors.push("admission.admissionId must be non-empty");
	if (proposalId === undefined) validationErrors.push("admission.proposalId must be non-empty");
	if (value.state !== "admitted" && value.state !== "rejected" && value.state !== "needs-review") {
		validationErrors.push("admission.state must be admitted, rejected, or needs-review");
	}
	if (value.targetRecordId !== undefined && !isNonEmptyString(value.targetRecordId)) {
		validationErrors.push("admission.targetRecordId must be non-empty when present");
	}
	if (value.reason !== undefined && typeof value.reason !== "string") {
		validationErrors.push("admission.reason must be a string when present");
	}
	for (const field of ["idempotencyKey", "correlationId", "causationId"] as const) {
		if (value[field] !== undefined && typeof value[field] !== "string") {
			validationErrors.push(`admission.${field} must be a string when present`);
		}
	}
	for (const [field, refs] of [
		["sourceRefs", value.sourceRefs],
		["policyRefs", value.policyRefs],
		["evidenceRefs", value.evidenceRefs],
	] as const) {
		if (refs !== undefined) {
			validationErrors.push(
				...validateAgenticMemoryFactRefs(refs).map((error) => `admission.${field}: ${error}`),
			);
		}
	}
	const candidate = validateCandidateMaterial<T>(value.candidateMaterial, index);
	if (candidate.issues.length > 0 || candidate.material === undefined) {
		validationErrors.push(
			...candidate.issues.flatMap((issue) =>
				(issue.refs ?? [issue.message]).map((message) => `candidateMaterial: ${message}`),
			),
		);
	}
	if (
		isNonEmptyString(value.targetRecordId) &&
		candidate.material?.targetRecordId !== undefined &&
		value.targetRecordId !== candidate.material.targetRecordId
	) {
		validationErrors.push(
			"admission.targetRecordId conflicts with candidateMaterial.targetRecordId",
		);
	}
	if (
		validationErrors.length > 0 ||
		admissionId === undefined ||
		proposalId === undefined ||
		candidate.material === undefined
	) {
		return {
			issues: [
				dataIssue("agentic-memory.application.invalid-admission", "admission is invalid", {
					severity: "error",
					subjectId: admissionId,
					path: [index],
					refs: validationErrors,
				}),
			],
		};
	}
	return {
		admission: Object.freeze({
			kind: "agentic-memory-record-admission",
			admissionId,
			proposalId,
			state: value.state as AgenticMemoryRecordAdmission<T>["state"],
			candidateMaterial: candidate.material,
			...(value.targetRecordId === undefined
				? {}
				: { targetRecordId: value.targetRecordId as FactId }),
			...(value.reason === undefined ? {} : { reason: value.reason as string }),
			...(value.sourceRefs === undefined
				? {}
				: { sourceRefs: snapshotAgenticMemoryFactRefs(value.sourceRefs) }),
			...(value.policyRefs === undefined
				? {}
				: { policyRefs: snapshotAgenticMemoryFactRefs(value.policyRefs) }),
			...(value.evidenceRefs === undefined
				? {}
				: { evidenceRefs: snapshotAgenticMemoryFactRefs(value.evidenceRefs) }),
			...(value.idempotencyKey === undefined
				? {}
				: { idempotencyKey: value.idempotencyKey as string }),
			...(value.correlationId === undefined
				? {}
				: { correlationId: value.correlationId as string }),
			...(value.causationId === undefined ? {} : { causationId: value.causationId as string }),
		}),
		issues: [],
	};
}

function validateCandidateMaterial<T>(
	value: unknown,
	index: number,
): {
	readonly material?: AgenticMemoryRecordCandidateMaterial<T>;
	readonly issues: readonly DataIssue[];
} {
	if (!isPlainRecord(value)) {
		return {
			issues: [
				dataIssue(
					"agentic-memory.application.invalid-admission",
					"candidateMaterial must be an object",
					{
						severity: "error",
						path: [index, "candidateMaterial"],
					},
				),
			],
		};
	}
	const validationErrors = [
		...dataRecordContainerErrors(value, "candidateMaterial"),
		...forbiddenAgenticMemoryDataFields(value, "candidateMaterial"),
	];
	if (value.kind !== "agentic-memory-record-candidate-material") {
		validationErrors.push(
			"candidateMaterial.kind must be agentic-memory-record-candidate-material",
		);
	}
	if (value.targetRecordId !== undefined && !isNonEmptyString(value.targetRecordId)) {
		validationErrors.push("candidateMaterial.targetRecordId must be non-empty when present");
	}
	for (const [field, refs] of [
		["sourceRefs", value.sourceRefs],
		["policyRefs", value.policyRefs],
		["evidenceRefs", value.evidenceRefs],
	] as const) {
		if (refs !== undefined) {
			validationErrors.push(
				...validateAgenticMemoryFactRefs(refs).map(
					(error) => `candidateMaterial.${field}: ${error}`,
				),
			);
		}
	}
	const metadata = snapshotMetadata(value.metadata, "candidateMaterial.metadata", validationErrors);
	const candidate = validateAndSnapshotRecord<T>(value.record, index);
	if (candidate.errors.length > 0 || candidate.record === undefined) {
		validationErrors.push(
			...candidate.errors.flatMap((error) =>
				(error.validationErrors ?? [error.message]).map(
					(message) => `candidateMaterial.record: ${message}`,
				),
			),
		);
	}
	const attribution = validateAgenticMemoryContextAttribution(value.attribution, {
		fragmentId: candidate.record?.fragment.id,
		recordId: candidate.record?.id,
	});
	if (!attribution.ok) {
		validationErrors.push(...attribution.errors.map((error) => `candidateMaterial.${error}`));
	}
	if (validationErrors.length > 0 || candidate.record === undefined) {
		return {
			issues: [
				dataIssue("agentic-memory.application.invalid-admission", "candidateMaterial is invalid", {
					severity: "error",
					path: [index, "candidateMaterial"],
					refs: validationErrors,
				}),
			],
		};
	}
	return {
		material: Object.freeze({
			kind: "agentic-memory-record-candidate-material",
			record: candidate.record,
			...(value.targetRecordId === undefined
				? {}
				: { targetRecordId: value.targetRecordId as FactId }),
			...(attribution.attribution === undefined ? {} : { attribution: attribution.attribution }),
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

function safeValidateApplicationPolicy(value: unknown): ValidatedPolicy {
	try {
		return validateApplicationPolicy(value);
	} catch (error) {
		return {
			invalidPolicies: 1,
			issues: [
				dataIssue(
					"agentic-memory.application-policy.invalid",
					`application policy access failed: ${errorMessage(error)}`,
					{ severity: "error" },
				),
			],
		};
	}
}

function validateApplicationPolicy(value: unknown): ValidatedPolicy {
	if (!isPlainRecord(value)) {
		return {
			invalidPolicies: 1,
			issues: [
				dataIssue(
					"agentic-memory.application-policy.invalid",
					"application policy must be an object",
					{
						severity: "error",
					},
				),
			],
		};
	}
	const validationErrors = [
		...dataRecordContainerErrors(value, "policy"),
		...forbiddenAgenticMemoryDataFields(value, "policy"),
	];
	if (value.kind !== "agentic-memory-record-application-policy") {
		validationErrors.push("policy.kind must be agentic-memory-record-application-policy");
	}
	const policyId = isNonEmptyString(value.policyId) ? value.policyId : undefined;
	if (policyId === undefined) validationErrors.push("policy.policyId must be non-empty");
	if (value.requireAdmittedState !== undefined && value.requireAdmittedState !== true) {
		validationErrors.push("policy.requireAdmittedState must be true when present");
	}
	for (const field of ["rejectDuplicateRecordIds", "rejectDuplicateFragmentIds"] as const) {
		if (value[field] !== undefined && value[field] !== true) {
			validationErrors.push(`policy.${field} must be true when present`);
		}
	}
	for (const [field, refs] of [
		["sourceRefs", value.sourceRefs],
		["policyRefs", value.policyRefs],
	] as const) {
		if (refs !== undefined) {
			validationErrors.push(
				...validateAgenticMemoryFactRefs(refs).map((error) => `policy.${field}: ${error}`),
			);
		}
	}
	const metadata = snapshotMetadata(value.metadata, "policy.metadata", validationErrors);
	if (validationErrors.length > 0 || policyId === undefined) {
		return {
			invalidPolicies: 1,
			issues: [
				dataIssue("agentic-memory.application-policy.invalid", "application policy is invalid", {
					severity: "error",
					subjectId: policyId,
					refs: validationErrors,
				}),
			],
		};
	}
	return {
		policy: Object.freeze({
			kind: "agentic-memory-record-application-policy",
			policyId,
			...(value.requireAdmittedState === undefined ? {} : { requireAdmittedState: true as const }),
			...(value.rejectDuplicateRecordIds === undefined
				? {}
				: { rejectDuplicateRecordIds: true as const }),
			...(value.rejectDuplicateFragmentIds === undefined
				? {}
				: { rejectDuplicateFragmentIds: true as const }),
			...(value.sourceRefs === undefined
				? {}
				: { sourceRefs: snapshotAgenticMemoryFactRefs(value.sourceRefs) }),
			...(value.policyRefs === undefined
				? {}
				: { policyRefs: snapshotAgenticMemoryFactRefs(value.policyRefs) }),
			...(metadata === undefined ? {} : { metadata }),
		}),
		issues: [],
		invalidPolicies: 0,
	};
}

function validateApplicationHistory(value: unknown): ValidatedHistory {
	try {
		return validateApplicationHistoryInner(value);
	} catch (error) {
		return {
			entries: Object.freeze([]),
			invalidEntries: 1,
			issues: [
				dataIssue(
					"agentic-memory.application-history.invalid",
					`application history access failed: ${errorMessage(error)}`,
					{ severity: "error" },
				),
			],
		};
	}
}

function validateApplicationHistoryInner(value: unknown): ValidatedHistory {
	if (value === undefined) return { entries: Object.freeze([]), invalidEntries: 0, issues: [] };
	let rawEntries: unknown;
	const issues: DataIssue[] = [];
	if (Array.isArray(value)) {
		rawEntries = value;
	} else if (isPlainRecord(value)) {
		const validationErrors = [
			...dataRecordContainerErrors(value, "history"),
			...forbiddenAgenticMemoryDataFields(value, "history"),
		];
		if (value.kind !== "agentic-memory-record-application-history") {
			validationErrors.push("history.kind must be agentic-memory-record-application-history");
		}
		for (const [field, refs] of [
			["sourceRefs", value.sourceRefs],
			["policyRefs", value.policyRefs],
		] as const) {
			if (refs !== undefined) {
				validationErrors.push(
					...validateAgenticMemoryFactRefs(refs).map((error) => `history.${field}: ${error}`),
				);
			}
		}
		snapshotMetadata(value.metadata, "history.metadata", validationErrors);
		rawEntries = value.entries;
		if (validationErrors.length > 0) {
			issues.push(
				dataIssue("agentic-memory.application-history.invalid", "application history is invalid", {
					severity: "error",
					refs: validationErrors,
				}),
			);
		}
	} else {
		return {
			entries: Object.freeze([]),
			invalidEntries: 1,
			issues: [
				dataIssue(
					"agentic-memory.application-history.invalid",
					"application history must be an object or array",
					{ severity: "error" },
				),
			],
		};
	}
	if (!Array.isArray(rawEntries)) {
		return {
			entries: Object.freeze([]),
			invalidEntries: 1,
			issues: Object.freeze([
				...issues,
				dataIssue(
					"agentic-memory.application-history.invalid",
					"application history entries must be an array",
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
			issues: Object.freeze([
				...issues,
				dataIssue(
					"agentic-memory.application-history.invalid",
					"application history entries length could not be read",
					{ severity: "error" },
				),
			]),
		};
	}
	const entries: AgenticMemoryRecordApplicationEvidence[] = [];
	let invalidEntries = 0;
	for (let index = 0; index < length; index += 1) {
		try {
			if (!Object.hasOwn(rawEntries, index)) throw new TypeError("history entries must be dense");
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
					"agentic-memory.application-history.invalid-entry",
					`application history entry access failed: ${errorMessage(error)}`,
					{ severity: "error", path: [index] },
				),
			);
		}
	}
	return {
		entries: Object.freeze(entries),
		invalidEntries,
		issues: Object.freeze(issues),
	};
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
					"agentic-memory.application-history.invalid-entry",
					"evidence must be an object",
					{
						severity: "error",
						path: [index],
					},
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
	if (validationErrors.length > 0) {
		return {
			issues: [
				dataIssue("agentic-memory.application-history.invalid-entry", "evidence is invalid", {
					severity: "error",
					path: [index],
					refs: validationErrors,
				}),
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
			...(value.idempotencyKey === undefined
				? {}
				: { idempotencyKey: value.idempotencyKey as string }),
			recordId: value.recordId as FactId,
			fragmentId: value.fragmentId as FactId,
			...(value.targetRecordId === undefined
				? {}
				: { targetRecordId: value.targetRecordId as FactId }),
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

function buildEvidenceIndex(
	entries: readonly AgenticMemoryRecordApplicationEvidence[],
): EvidenceIndex {
	const byAdmissionId = new Map<FactId, AgenticMemoryRecordApplicationEvidence[]>();
	const byIdempotencyKey = new Map<string, AgenticMemoryRecordApplicationEvidence[]>();
	const issues: DataIssue[] = [];
	for (const entry of entries) {
		const admissionEntries = byAdmissionId.get(entry.admissionId) ?? [];
		const existingAdmission = admissionEntries.find((candidate) =>
			evidenceScopesOverlap(candidate, entry),
		);
		if (
			existingAdmission !== undefined &&
			evidenceMaterialKey(existingAdmission) !== evidenceMaterialKey(entry)
		) {
			issues.push(
				dataIssue(
					"agentic-memory.application-history.conflicting-admission-evidence",
					"application history reuses admissionId with conflicting material",
					{ severity: "error", subjectId: entry.admissionId },
				),
			);
		} else {
			admissionEntries.push(entry);
			byAdmissionId.set(entry.admissionId, admissionEntries);
		}
		if (entry.idempotencyKey === undefined) continue;
		const idempotencyEntries = byIdempotencyKey.get(entry.idempotencyKey) ?? [];
		const existingIdempotency = idempotencyEntries.find((candidate) =>
			evidenceScopesOverlap(candidate, entry),
		);
		if (
			existingIdempotency !== undefined &&
			evidenceMaterialKey(existingIdempotency) !== evidenceMaterialKey(entry)
		) {
			issues.push(
				dataIssue(
					"agentic-memory.application-history.conflicting-idempotency-evidence",
					"application history reuses idempotencyKey with conflicting material",
					{ severity: "error", subjectId: entry.idempotencyKey, refs: [entry.admissionId] },
				),
			);
		} else {
			idempotencyEntries.push(entry);
			byIdempotencyKey.set(entry.idempotencyKey, idempotencyEntries);
		}
	}
	return {
		byAdmissionId: freezeEvidenceMap(byAdmissionId),
		byIdempotencyKey: freezeEvidenceMap(byIdempotencyKey),
		issues: Object.freeze(issues),
	};
}

function scopedEvidence(
	entries: readonly AgenticMemoryRecordApplicationEvidence[] | undefined,
	applicationId: FactId,
): readonly AgenticMemoryRecordApplicationEvidence[] {
	return (
		entries?.filter(
			(entry) => entry.applicationId === undefined || entry.applicationId === applicationId,
		) ?? []
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

function freezeEvidenceMap<K>(
	map: Map<K, AgenticMemoryRecordApplicationEvidence[]>,
): ReadonlyMap<K, readonly AgenticMemoryRecordApplicationEvidence[]> {
	return new Map([...map].map(([key, entries]) => [key, Object.freeze(entries)]));
}

function applicationAudit<T>(
	decision: AgenticMemoryRecordApplicationDecision<T>,
): AgenticMemoryRecordApplicationAuditEntry {
	return Object.freeze({
		kind: "agentic-memory-record-application-audit",
		applicationId: decision.applicationId,
		admissionId: decision.admissionId,
		proposalId: decision.proposalId,
		state: decision.state,
		reasonCode: decision.reasonCode,
		...(decision.reason === undefined ? {} : { reason: decision.reason }),
		recordId: decision.candidateMaterial.record.id,
		fragmentId: decision.candidateMaterial.record.fragment.id,
		...(decision.targetRecordId === undefined ? {} : { targetRecordId: decision.targetRecordId }),
		...(decision.idempotencyKey === undefined ? {} : { idempotencyKey: decision.idempotencyKey }),
		...(decision.sourceRefs === undefined ? {} : { sourceRefs: decision.sourceRefs }),
		...(decision.policyRefs === undefined ? {} : { policyRefs: decision.policyRefs }),
		...(decision.evidenceRefs === undefined ? {} : { evidenceRefs: decision.evidenceRefs }),
	});
}

function evidenceFromDecision<T>(
	decision: AgenticMemoryRecordApplicationDecision<T>,
): AgenticMemoryRecordApplicationEvidence {
	return Object.freeze({
		kind: "agentic-memory-record-application-evidence",
		applicationId: decision.applicationId,
		admissionId: decision.admissionId,
		proposalId: decision.proposalId,
		...(decision.idempotencyKey === undefined ? {} : { idempotencyKey: decision.idempotencyKey }),
		recordId: decision.candidateMaterial.record.id,
		fragmentId: decision.candidateMaterial.record.fragment.id,
		targetRecordId: decision.targetRecordId ?? decision.candidateMaterial.record.id,
	});
}

function applicationStatus(
	cursor: AgenticMemoryRecordApplicationCursor,
): AgenticMemoryRecordApplicationStatusState {
	if (cursor.admissions === 0 && cursor.issues === 0) return "empty";
	if (cursor.issues > 0 && cursor.applied + cursor.skipped + cursor.rejected === 0) return "error";
	if (cursor.issues > 0) return "partial";
	if (cursor.applied === 0 && cursor.skipped > 0) return "blocked";
	return "ready";
}

function recordProjectionIssue(
	error: ReturnType<typeof validateAndProjectRecords>["errors"][number],
): DataIssue {
	return dataIssue("agentic-memory.record.invalid", error.message, {
		severity: "error",
		subjectId: error.recordId,
		refs: error.validationErrors,
	});
}

function safeInputLength(value: unknown): number {
	if (!Array.isArray(value)) return 0;
	return safeArrayLength(value) ?? 0;
}

function applicationMaterialKey(input: {
	readonly recordId: FactId;
	readonly fragmentId: FactId;
	readonly targetRecordId?: FactId;
}): string {
	return canonicalTupleKey([
		input.recordId,
		input.fragmentId,
		input.targetRecordId ?? input.recordId,
	]);
}

function evidenceMaterialKey(evidence: AgenticMemoryRecordApplicationEvidence): string {
	return applicationMaterialKey({
		recordId: evidence.recordId,
		fragmentId: evidence.fragmentId,
		targetRecordId: evidence.targetRecordId,
	});
}

function freezeDecision<T>(
	decision: AgenticMemoryRecordApplicationDecision<T>,
): AgenticMemoryRecordApplicationDecision<T> {
	return Object.freeze(decision);
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
		if (!descriptor.enumerable) {
			errors.push(`${label}.${key} must be enumerable`);
		}
	}
	return errors;
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
