import { depLatest } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import { strictJsonCodec } from "../json/codec.js";
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
	AgenticMemoryProposalAdmissionAudit,
	AgenticMemoryProposalAdmissionCursor,
	AgenticMemoryProposalAdmissionDecision,
	AgenticMemoryProposalAdmissionDecisionState,
	AgenticMemoryProposalAdmissionOptions,
	AgenticMemoryProposalAdmissionPolicy,
	AgenticMemoryProposalAdmissionSnapshot,
	AgenticMemoryProposalAdmissionStatus,
	AgenticMemoryRecordAdmissionBundle,
	AgenticMemoryRecordAdmissionBundleOptions,
	AgenticMemoryRecordCandidateMaterial,
	AgenticMemoryRecordProposal,
} from "./agentic-memory-types.js";

export function agenticMemoryRecordAdmissionBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryRecordAdmissionBundleOptions<T>,
): AgenticMemoryRecordAdmissionBundle<T> {
	const name = opts.name ?? "agenticMemoryRecordAdmission";
	const projection = graph.node<AgenticMemoryProposalAdmissionSnapshot<T>>(
		[opts.records, opts.proposals, opts.policy],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const recordProjection = validateAndProjectRecords<T>(depLatest(ctx, 0));
			const policy = safeValidateAdmissionPolicy(depLatest(ctx, 2));
			const projected = projectProposalAdmissions<T>(depLatest(ctx, 1), policy.policy, {
				records: recordProjection.records,
				evaluation: state.evaluation,
			});
			const cursor = Object.freeze({
				...projected.cursor,
				invalidPolicies: policy.invalidPolicies,
				issues: recordProjection.errors.length + policy.issues.length + projected.issues.length,
			});
			const issues = Object.freeze([
				...recordProjectionIssues(recordProjection.errors),
				...policy.issues,
				...projected.issues,
			]);
			const status: AgenticMemoryProposalAdmissionStatus = Object.freeze({
				state: admissionStatus(cursor),
				cursor,
			});
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						admissions: projected.admissions,
						admitted: projected.admitted,
						rejected: projected.rejected,
						needsReview: projected.needsReview,
						status,
						issues,
						audit: projected.audit,
						cursor,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryRecordAdmission",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { records: opts.records, proposals: opts.proposals, policy: opts.policy },
		projection,
		admissions: solutionProjection(
			graph,
			projection,
			`${name}/admissions`,
			"agenticMemoryRecordAdmissions",
			(fact) => fact.admissions,
		),
		admitted: solutionProjection(
			graph,
			projection,
			`${name}/admitted`,
			"agenticMemoryRecordAdmissionsAdmitted",
			(fact) => fact.admitted,
		),
		rejected: solutionProjection(
			graph,
			projection,
			`${name}/rejected`,
			"agenticMemoryRecordAdmissionsRejected",
			(fact) => fact.rejected,
		),
		needsReview: solutionProjection(
			graph,
			projection,
			`${name}/needsReview`,
			"agenticMemoryRecordAdmissionsNeedsReview",
			(fact) => fact.needsReview,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryRecordAdmissionStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryRecordAdmissionIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryRecordAdmissionAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryRecordAdmissionCursor",
			(fact) => fact.cursor,
		),
	};
}

export function admitAgenticMemoryRecordProposals<T = unknown>(
	proposals: unknown,
	policy: unknown,
	opts: AgenticMemoryProposalAdmissionOptions<T> = {},
): AgenticMemoryProposalAdmissionSnapshot<T> {
	const validatedPolicy = safeValidateAdmissionPolicy(policy);
	const recordProjection = validateAndProjectRecords<T>(opts.records ?? []);
	const projected = projectProposalAdmissions<T>(proposals, validatedPolicy.policy, {
		...opts,
		records: recordProjection.records,
	});
	const cursor = Object.freeze({
		...projected.cursor,
		invalidPolicies: validatedPolicy.invalidPolicies,
		issues:
			recordProjection.errors.length + validatedPolicy.issues.length + projected.issues.length,
	});
	return Object.freeze({
		admissions: projected.admissions,
		admitted: projected.admitted,
		rejected: projected.rejected,
		needsReview: projected.needsReview,
		status: Object.freeze({
			state: admissionStatus(cursor),
			cursor,
		}),
		issues: Object.freeze([
			...recordProjectionIssues(recordProjection.errors),
			...validatedPolicy.issues,
			...projected.issues,
		]),
		audit: projected.audit,
		cursor,
	});
}

function projectProposalAdmissions<T>(
	value: unknown,
	policy: AgenticMemoryProposalAdmissionPolicy,
	opts: AgenticMemoryProposalAdmissionOptions<T> = {},
): {
	readonly proposals: number;
	readonly validProposals: number;
	readonly invalidProposals: number;
	readonly admissions: readonly AgenticMemoryProposalAdmissionDecision<T>[];
	readonly admitted: readonly AgenticMemoryProposalAdmissionDecision<T>[];
	readonly rejected: readonly AgenticMemoryProposalAdmissionDecision<T>[];
	readonly needsReview: readonly AgenticMemoryProposalAdmissionDecision<T>[];
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryProposalAdmissionAudit[];
	readonly cursor: Omit<AgenticMemoryProposalAdmissionSnapshot<T>["cursor"], "invalidPolicies">;
} {
	const admissions: AgenticMemoryProposalAdmissionDecision<T>[] = [];
	const issues: DataIssue[] = [];
	const audit: AgenticMemoryProposalAdmissionAudit[] = [];
	let proposals = 0;
	let invalidProposals = 0;
	const records = opts.records ?? [];
	if (!Array.isArray(value)) {
		return {
			proposals,
			validProposals: 0,
			invalidProposals: 1,
			admissions: Object.freeze(admissions),
			admitted: Object.freeze([]),
			rejected: Object.freeze([]),
			needsReview: Object.freeze([]),
			issues: Object.freeze([
				dataIssue("agentic-memory.proposal.invalid-input", "proposals input must be an array", {
					severity: "error",
				}),
			]),
			audit: Object.freeze(audit),
			cursor: proposalAdmissionCursor(opts.evaluation, 0, 0, 1, 0, 0, 0, 1),
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			proposals,
			validProposals: 0,
			invalidProposals: 1,
			admissions: Object.freeze(admissions),
			admitted: Object.freeze([]),
			rejected: Object.freeze([]),
			needsReview: Object.freeze([]),
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.proposal.invalid-input",
					"proposals input length could not be read",
					{ severity: "error" },
				),
			]),
			audit: Object.freeze(audit),
			cursor: proposalAdmissionCursor(opts.evaluation, 0, 0, 1, 0, 0, 0, 1),
		};
	}
	proposals = length;
	const seenProposals = new Set<FactId>();
	const seenCandidateRecordIds = new Set<FactId>();
	const seenTargetRecordIds = new Set<FactId>();
	const currentRecordIds = new Set(records.map((record) => record.id));
	for (let index = 0; index < length; index += 1) {
		let raw: unknown;
		let proposal: AgenticMemoryRecordProposal<T> | undefined;
		try {
			if (!Object.hasOwn(value, index)) throw new TypeError("proposal array must be dense");
			raw = value[index];
			const result = validateProposal<T>(raw, index);
			if (result.proposal === undefined) {
				invalidProposals += 1;
				issues.push(...result.issues);
				continue;
			}
			proposal = result.proposal;
		} catch (error) {
			invalidProposals += 1;
			issues.push(
				dataIssue(
					"agentic-memory.proposal.invalid",
					`proposal access failed: ${errorMessage(error)}`,
					{ severity: "error", path: [index] },
				),
			);
			continue;
		}
		if (seenProposals.has(proposal.proposalId)) {
			invalidProposals += 1;
			issues.push(
				dataIssue("agentic-memory.proposal.duplicate-id", "duplicate proposal id", {
					severity: "error",
					subjectId: proposal.proposalId,
					path: [index],
				}),
			);
			continue;
		}
		seenProposals.add(proposal.proposalId);
		if (seenCandidateRecordIds.has(proposal.candidateMaterial.record.id)) {
			invalidProposals += 1;
			issues.push(
				dataIssue(
					"agentic-memory.proposal.duplicate-candidate-record-id",
					"duplicate candidate record id in proposal batch",
					{
						severity: "error",
						subjectId: proposal.proposalId,
						path: [index, "candidateMaterial", "record", "id"],
						refs: [proposal.candidateMaterial.record.id],
					},
				),
			);
			continue;
		}
		seenCandidateRecordIds.add(proposal.candidateMaterial.record.id);
		const effectiveTargetRecordId =
			proposal.targetRecordId ??
			proposal.candidateMaterial.targetRecordId ??
			proposal.candidateMaterial.record.id;
		if (seenTargetRecordIds.has(effectiveTargetRecordId)) {
			invalidProposals += 1;
			issues.push(
				dataIssue(
					"agentic-memory.proposal.duplicate-target-record-id",
					"duplicate target record id in proposal batch",
					{
						severity: "error",
						subjectId: proposal.proposalId,
						path: [index, "targetRecordId"],
						refs: [effectiveTargetRecordId],
					},
				),
			);
			continue;
		}
		seenTargetRecordIds.add(effectiveTargetRecordId);
		const admission = admitProposal(proposal, currentRecordIds, policy);
		admissions.push(admission);
		audit.push(admissionAudit(admission, policy));
	}
	const admitted = Object.freeze(admissions.filter((admission) => admission.state === "admitted"));
	const rejected = Object.freeze(admissions.filter((admission) => admission.state === "rejected"));
	const needsReview = Object.freeze(
		admissions.filter((admission) => admission.state === "needs-review"),
	);
	return {
		proposals,
		validProposals: admissions.length,
		invalidProposals,
		admissions: Object.freeze(admissions),
		admitted,
		rejected,
		needsReview,
		issues: Object.freeze(issues),
		audit: Object.freeze(audit),
		cursor: proposalAdmissionCursor(
			opts.evaluation,
			proposals,
			admissions.length,
			invalidProposals,
			admitted.length,
			rejected.length,
			needsReview.length,
			issues.length,
		),
	};
}

function validateProposal<T>(
	value: unknown,
	index: number,
): {
	readonly proposal?: AgenticMemoryRecordProposal<T>;
	readonly issues: readonly DataIssue[];
} {
	if (!isPlainRecord(value)) {
		return {
			issues: [
				dataIssue("agentic-memory.proposal.invalid", "proposal must be an object", {
					severity: "error",
					path: [index],
				}),
			],
		};
	}
	const validationErrors: string[] = [];
	validationErrors.push(...forbiddenAgenticMemoryDataFields(value, "proposal"));
	if (value.kind !== "agentic-memory-record-proposal") {
		validationErrors.push("proposal.kind must be agentic-memory-record-proposal");
	}
	const proposalId = isNonEmptyString(value.proposalId) ? value.proposalId : undefined;
	if (proposalId === undefined) validationErrors.push("proposal.proposalId must be non-empty");
	if (value.targetRecordId !== undefined && !isNonEmptyString(value.targetRecordId)) {
		validationErrors.push("proposal.targetRecordId must be non-empty when present");
	}
	if (value.operation !== undefined && typeof value.operation !== "string") {
		validationErrors.push("proposal.operation must be a string when present");
	}
	if (
		value.operationVersion !== undefined &&
		(typeof value.operationVersion !== "number" || !Number.isInteger(value.operationVersion))
	) {
		validationErrors.push("proposal.operationVersion must be an integer when present");
	}
	for (const [field, refs] of [
		["sourceRefs", value.sourceRefs],
		["policyRefs", value.policyRefs],
		["evidenceRefs", value.evidenceRefs],
	] as const) {
		if (refs !== undefined) {
			const refErrors = validateAgenticMemoryFactRefs(refs);
			if (refErrors.length > 0) {
				validationErrors.push(...refErrors.map((error) => `proposal.${field}: ${error}`));
			}
		}
	}
	const candidateMaterial = validateCandidateMaterial<T>(value.candidateMaterial, index);
	if (candidateMaterial.issues.length > 0 || candidateMaterial.material === undefined) {
		validationErrors.push(
			...candidateMaterial.issues.flatMap((issue) =>
				(issue.refs ?? [issue.message]).map((message) => `candidateMaterial: ${message}`),
			),
		);
	}
	if (
		isNonEmptyString(value.targetRecordId) &&
		candidateMaterial.material?.targetRecordId !== undefined &&
		value.targetRecordId !== candidateMaterial.material.targetRecordId
	) {
		validationErrors.push(
			"proposal.targetRecordId conflicts with candidateMaterial.targetRecordId",
		);
	}
	if (
		typeof value.operation === "string" &&
		candidateMaterial.material?.operation !== undefined &&
		value.operation !== candidateMaterial.material.operation
	) {
		validationErrors.push("proposal.operation conflicts with candidateMaterial.operation");
	}
	if (
		typeof value.operationVersion === "number" &&
		candidateMaterial.material?.operationVersion !== undefined &&
		value.operationVersion !== candidateMaterial.material.operationVersion
	) {
		validationErrors.push(
			"proposal.operationVersion conflicts with candidateMaterial.operationVersion",
		);
	}
	if (value.metadata !== undefined && !isStrictJsonObject(value.metadata)) {
		validationErrors.push("proposal.metadata must be a strict JSON object");
	}
	for (const field of [
		"reason",
		"proposalStatus",
		"idempotencyKey",
		"correlationId",
		"causationId",
	]) {
		const current = value[field];
		if (current !== undefined && typeof current !== "string") {
			validationErrors.push(`proposal.${field} must be a string when present`);
		}
	}
	if (
		validationErrors.length > 0 ||
		proposalId === undefined ||
		candidateMaterial.material === undefined
	) {
		return {
			issues: [
				dataIssue("agentic-memory.proposal.invalid", "proposal is invalid", {
					severity: "error",
					subjectId: proposalId,
					path: [index],
					refs: validationErrors,
				}),
			],
		};
	}
	return {
		proposal: Object.freeze({
			kind: "agentic-memory-record-proposal",
			proposalId,
			...(value.operation === undefined
				? {}
				: { operation: value.operation as AgenticMemoryRecordProposal<T>["operation"] }),
			...(value.operationVersion === undefined
				? {}
				: {
						operationVersion:
							value.operationVersion as AgenticMemoryRecordProposal<T>["operationVersion"],
					}),
			candidateMaterial: candidateMaterial.material,
			...(value.targetRecordId === undefined
				? {}
				: { targetRecordId: value.targetRecordId as FactId }),
			...(value.reason === undefined ? {} : { reason: value.reason as string }),
			...(value.proposalStatus === undefined
				? {}
				: { proposalStatus: value.proposalStatus as string }),
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
			...(value.metadata === undefined ? {} : { metadata: cloneStrictJsonObject(value.metadata) }),
		}),
		issues: [],
	};
}

function recordProjectionIssues(
	errors: readonly ReturnType<typeof validateAndProjectRecords>["errors"][number][],
): readonly DataIssue[] {
	return errors.map((error) =>
		dataIssue("agentic-memory.record.invalid", error.message, {
			severity: "error",
			subjectId: error.recordId,
			refs: error.validationErrors,
		}),
	);
}

function admitProposal<T>(
	proposal: AgenticMemoryRecordProposal<T>,
	currentRecordIds: ReadonlySet<FactId>,
	policy: AgenticMemoryProposalAdmissionPolicy,
): AgenticMemoryProposalAdmissionDecision<T> {
	const targetRecordId = proposal.targetRecordId ?? proposal.candidateMaterial.targetRecordId;
	const duplicate =
		(policy.rejectDuplicateRecordIds ?? true) &&
		currentRecordIds.has(proposal.candidateMaterial.record.id) &&
		targetRecordId !== proposal.candidateMaterial.record.id;
	const missingSourceRefs =
		(policy.requireSourceRefs ?? false) &&
		(proposal.sourceRefs?.length ?? 0) + (proposal.candidateMaterial.sourceRefs?.length ?? 0) === 0;
	const state: AgenticMemoryProposalAdmissionDecisionState = duplicate
		? "rejected"
		: missingSourceRefs
			? "needs-review"
			: (policy.defaultState ?? "needs-review");
	const reason = duplicate
		? "candidate record id already exists"
		: missingSourceRefs
			? "policy requires sourceRefs"
			: (proposal.reason ?? `policy:${policy.policyId}`);
	const evidenceRefs = mergeRefs([
		...(proposal.candidateMaterial.evidenceRefs ?? []),
		...(proposal.evidenceRefs ?? []),
	]);
	return Object.freeze({
		kind: "agentic-memory-record-admission",
		admissionId: compoundTupleKey("admission", [policy.policyId, proposal.proposalId]),
		proposalId: proposal.proposalId,
		state,
		...(proposal.operation === undefined ? {} : { operation: proposal.operation }),
		...(proposal.operationVersion === undefined
			? {}
			: { operationVersion: proposal.operationVersion }),
		candidateMaterial: proposal.candidateMaterial,
		...(targetRecordId === undefined ? {} : { targetRecordId }),
		reason,
		sourceRefs: mergeRefs([
			...(proposal.candidateMaterial.sourceRefs ?? []),
			...(proposal.sourceRefs ?? []),
			...(policy.sourceRefs ?? []),
		]),
		policyRefs: mergeRefs([
			...(proposal.candidateMaterial.policyRefs ?? []),
			...(proposal.policyRefs ?? []),
			{ kind: "agentic-memory-record-admission-policy", id: policy.policyId },
			...(policy.policyRefs ?? []),
		]),
		...(evidenceRefs === undefined ? {} : { evidenceRefs }),
		...(proposal.idempotencyKey === undefined ? {} : { idempotencyKey: proposal.idempotencyKey }),
		...(proposal.correlationId === undefined ? {} : { correlationId: proposal.correlationId }),
		...(proposal.causationId === undefined ? {} : { causationId: proposal.causationId }),
	});
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
				dataIssue("agentic-memory.proposal.invalid", "candidateMaterial must be an object", {
					severity: "error",
					path: [index, "candidateMaterial"],
				}),
			],
		};
	}
	const validationErrors: string[] = [];
	validationErrors.push(...forbiddenAgenticMemoryDataFields(value, "candidateMaterial"));
	if (value.kind !== "agentic-memory-record-candidate-material") {
		validationErrors.push(
			"candidateMaterial.kind must be agentic-memory-record-candidate-material",
		);
	}
	if (value.targetRecordId !== undefined && !isNonEmptyString(value.targetRecordId)) {
		validationErrors.push("candidateMaterial.targetRecordId must be non-empty when present");
	}
	if (value.operation !== undefined && typeof value.operation !== "string") {
		validationErrors.push("candidateMaterial.operation must be a string when present");
	}
	if (
		value.operationVersion !== undefined &&
		(typeof value.operationVersion !== "number" || !Number.isInteger(value.operationVersion))
	) {
		validationErrors.push("candidateMaterial.operationVersion must be an integer when present");
	}
	for (const [field, refs] of [
		["sourceRefs", value.sourceRefs],
		["policyRefs", value.policyRefs],
		["evidenceRefs", value.evidenceRefs],
	] as const) {
		if (refs !== undefined) {
			const refErrors = validateAgenticMemoryFactRefs(refs);
			if (refErrors.length > 0) {
				validationErrors.push(...refErrors.map((error) => `candidateMaterial.${field}: ${error}`));
			}
		}
	}
	if (value.metadata !== undefined && !isStrictJsonObject(value.metadata)) {
		validationErrors.push("candidateMaterial.metadata must be a strict JSON object");
	}
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
				dataIssue("agentic-memory.proposal.invalid", "candidateMaterial is invalid", {
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
			...(value.operation === undefined
				? {}
				: { operation: value.operation as AgenticMemoryRecordCandidateMaterial<T>["operation"] }),
			...(value.operationVersion === undefined
				? {}
				: {
						operationVersion:
							value.operationVersion as AgenticMemoryRecordCandidateMaterial<T>["operationVersion"],
					}),
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
			...(value.metadata === undefined ? {} : { metadata: cloneStrictJsonObject(value.metadata) }),
		}),
		issues: [],
	};
}

function admissionAudit<T>(
	admission: AgenticMemoryProposalAdmissionDecision<T>,
	policy: AgenticMemoryProposalAdmissionPolicy,
): AgenticMemoryProposalAdmissionAudit {
	return Object.freeze({
		kind: "agentic-memory-record-admission-audit",
		admissionId: admission.admissionId,
		proposalId: admission.proposalId,
		state: admission.state,
		reason: admission.reason,
		sourceRefs: admission.sourceRefs,
		policyRefs: mergeRefs([
			...(admission.policyRefs ?? []),
			{ kind: "agentic-memory-record-admission-policy", id: policy.policyId },
		]),
	});
}

function safeValidateAdmissionPolicy(value: unknown): {
	readonly policy: AgenticMemoryProposalAdmissionPolicy;
	readonly issues: readonly DataIssue[];
	readonly invalidPolicies: number;
} {
	try {
		return validateAdmissionPolicy(value);
	} catch (error) {
		return {
			policy: defaultAdmissionPolicy(),
			invalidPolicies: 1,
			issues: [
				dataIssue(
					"agentic-memory.admission-policy.invalid",
					`admission policy access failed: ${errorMessage(error)}`,
					{ severity: "error" },
				),
			],
		};
	}
}

function validateAdmissionPolicy(value: unknown): {
	readonly policy: AgenticMemoryProposalAdmissionPolicy;
	readonly issues: readonly DataIssue[];
	readonly invalidPolicies: number;
} {
	if (!isPlainRecord(value)) {
		return {
			policy: defaultAdmissionPolicy(),
			invalidPolicies: 1,
			issues: [
				dataIssue("agentic-memory.admission-policy.invalid", "admission policy must be an object", {
					severity: "error",
				}),
			],
		};
	}
	const validationErrors: string[] = [];
	validationErrors.push(...forbiddenAgenticMemoryDataFields(value, "policy"));
	if (value.kind !== "agentic-memory-record-admission-policy") {
		validationErrors.push("policy.kind must be agentic-memory-record-admission-policy");
	}
	const policyId = isNonEmptyString(value.policyId) ? value.policyId : undefined;
	if (policyId === undefined) validationErrors.push("policy.policyId must be non-empty");
	if (
		value.defaultState !== undefined &&
		value.defaultState !== "admitted" &&
		value.defaultState !== "rejected" &&
		value.defaultState !== "needs-review"
	) {
		validationErrors.push("policy.defaultState must be admitted, rejected, or needs-review");
	}
	for (const field of ["requireSourceRefs", "rejectDuplicateRecordIds"]) {
		if (value[field] !== undefined && typeof value[field] !== "boolean") {
			validationErrors.push(`policy.${field} must be boolean when present`);
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
	if (value.metadata !== undefined && !isStrictJsonObject(value.metadata)) {
		validationErrors.push("policy.metadata must be a strict JSON object");
	}
	if (validationErrors.length > 0 || policyId === undefined) {
		return {
			policy: defaultAdmissionPolicy(),
			invalidPolicies: 1,
			issues: [
				dataIssue("agentic-memory.admission-policy.invalid", "admission policy is invalid", {
					severity: "error",
					subjectId: policyId,
					refs: validationErrors,
				}),
			],
		};
	}
	return {
		policy: Object.freeze({
			kind: "agentic-memory-record-admission-policy",
			policyId,
			...(value.defaultState === undefined
				? {}
				: { defaultState: value.defaultState as AgenticMemoryProposalAdmissionDecisionState }),
			...(value.requireSourceRefs === undefined
				? {}
				: { requireSourceRefs: value.requireSourceRefs as boolean }),
			...(value.rejectDuplicateRecordIds === undefined
				? {}
				: { rejectDuplicateRecordIds: value.rejectDuplicateRecordIds as boolean }),
			...(value.sourceRefs === undefined
				? {}
				: { sourceRefs: snapshotAgenticMemoryFactRefs(value.sourceRefs) }),
			...(value.policyRefs === undefined
				? {}
				: { policyRefs: snapshotAgenticMemoryFactRefs(value.policyRefs) }),
			...(value.metadata === undefined ? {} : { metadata: cloneStrictJsonObject(value.metadata) }),
		}),
		issues: [],
		invalidPolicies: 0,
	};
}

function isStrictJsonObject(value: unknown): boolean {
	if (!isPlainRecord(value)) return false;
	try {
		strictJsonCodec.encode(value);
		return true;
	} catch {
		return false;
	}
}

function defaultAdmissionPolicy(): AgenticMemoryProposalAdmissionPolicy {
	return Object.freeze({
		kind: "agentic-memory-record-admission-policy",
		policyId: "invalid-policy",
		defaultState: "rejected",
	});
}

function proposalAdmissionCursor(
	evaluation: number | undefined,
	proposals: number,
	validProposals: number,
	invalidProposals: number,
	admitted: number,
	rejected: number,
	needsReview: number,
	issues: number,
): Omit<AgenticMemoryProposalAdmissionCursor, "invalidPolicies"> {
	return Object.freeze({
		evaluation: evaluation ?? 0,
		proposals,
		validProposals,
		invalidProposals,
		admitted,
		rejected,
		needsReview,
		issues,
	});
}

function admissionStatus(
	cursor: AgenticMemoryProposalAdmissionCursor,
): AgenticMemoryProposalAdmissionStatus["state"] {
	if ((cursor.invalidProposals > 0 || cursor.invalidPolicies > 0) && cursor.validProposals === 0) {
		return "error";
	}
	if (cursor.invalidProposals > 0 || cursor.invalidPolicies > 0 || cursor.issues > 0) {
		return "partial";
	}
	if (cursor.proposals === 0) return "empty";
	if (cursor.needsReview > 0) return "blocked";
	return "ready";
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
