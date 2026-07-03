import { depLatest } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import { strictJsonCodec } from "../json/codec.js";
import type { FactId } from "../patterns/semantic-memory.js";
import { solutionProjection } from "./agentic-memory-projection.js";
import {
	errorMessage,
	isNonEmptyString,
	isPlainRecord,
	safeArrayLength,
	validateAndProjectRecords,
	validateAndSnapshotRecord,
} from "./agentic-memory-shared.js";
import type {
	AgenticMemoryFactRef,
	AgenticMemoryRecord,
	AgenticMemoryRecordAdmission,
	AgenticMemoryRecordAdmissionAuditEntry,
	AgenticMemoryRecordAdmissionBundle,
	AgenticMemoryRecordAdmissionBundleOptions,
	AgenticMemoryRecordAdmissionCursor,
	AgenticMemoryRecordAdmissionDecisionState,
	AgenticMemoryRecordAdmissionPolicy,
	AgenticMemoryRecordAdmissionSnapshot,
	AgenticMemoryRecordAdmissionStatus,
	AgenticMemoryRecordProposal,
	StrictJsonValue,
} from "./agentic-memory-types.js";

export function agenticMemoryRecordAdmissionBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryRecordAdmissionBundleOptions<T>,
): AgenticMemoryRecordAdmissionBundle<T> {
	const name = opts.name ?? "agenticMemoryRecordAdmission";
	const projection = graph.node<AgenticMemoryRecordAdmissionSnapshot<T>>(
		[opts.records, opts.proposals, opts.policy],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const recordProjection = validateAndProjectRecords<T>(depLatest(ctx, 0));
			const policy = safeValidateAdmissionPolicy(depLatest(ctx, 2));
			const projected = projectProposalAdmissions<T>(
				depLatest(ctx, 1),
				recordProjection.records,
				policy.policy,
			);
			const cursor: AgenticMemoryRecordAdmissionCursor = Object.freeze({
				evaluation: state.evaluation,
				proposals: projected.proposals,
				validProposals: projected.validProposals,
				invalidProposals: projected.invalidProposals,
				invalidPolicies: policy.invalidPolicies,
				admitted: projected.admitted.length,
				rejected: projected.rejected.length,
				needsReview: projected.needsReview.length,
				issues: recordProjection.errors.length + policy.issues.length + projected.issues.length,
			});
			const issues = Object.freeze([
				...recordProjection.errors.map((error) =>
					dataIssue("agentic-memory.record.invalid", error.message, {
						severity: "error",
						subjectId: error.recordId,
						refs: error.validationErrors,
					}),
				),
				...policy.issues,
				...projected.issues,
			]);
			const status: AgenticMemoryRecordAdmissionStatus = Object.freeze({
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

function projectProposalAdmissions<T>(
	value: unknown,
	records: readonly AgenticMemoryRecord<T>[],
	policy: AgenticMemoryRecordAdmissionPolicy,
): {
	readonly proposals: number;
	readonly validProposals: number;
	readonly invalidProposals: number;
	readonly admissions: readonly AgenticMemoryRecordAdmission<T>[];
	readonly admitted: readonly AgenticMemoryRecordAdmission<T>[];
	readonly rejected: readonly AgenticMemoryRecordAdmission<T>[];
	readonly needsReview: readonly AgenticMemoryRecordAdmission<T>[];
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryRecordAdmissionAuditEntry[];
} {
	const admissions: AgenticMemoryRecordAdmission<T>[] = [];
	const issues: DataIssue[] = [];
	const audit: AgenticMemoryRecordAdmissionAuditEntry[] = [];
	let proposals = 0;
	let invalidProposals = 0;
	if (!Array.isArray(value)) {
		return {
			proposals,
			validProposals: 0,
			invalidProposals: 1,
			admissions,
			admitted: [],
			rejected: [],
			needsReview: [],
			issues: [
				dataIssue("agentic-memory.proposal.invalid-input", "proposals input must be an array", {
					severity: "error",
				}),
			],
			audit,
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			proposals,
			validProposals: 0,
			invalidProposals: 1,
			admissions,
			admitted: [],
			rejected: [],
			needsReview: [],
			issues: [
				dataIssue(
					"agentic-memory.proposal.invalid-input",
					"proposals input length could not be read",
					{ severity: "error" },
				),
			],
			audit,
		};
	}
	proposals = length;
	const seenProposals = new Set<FactId>();
	const seenCandidateRecordIds = new Set<FactId>();
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
		if (seenCandidateRecordIds.has(proposal.candidateRecord.id)) {
			invalidProposals += 1;
			issues.push(
				dataIssue(
					"agentic-memory.proposal.duplicate-candidate-record-id",
					"duplicate candidate record id in proposal batch",
					{
						severity: "error",
						subjectId: proposal.proposalId,
						path: [index, "candidateRecord", "id"],
						refs: [proposal.candidateRecord.id],
					},
				),
			);
			continue;
		}
		seenCandidateRecordIds.add(proposal.candidateRecord.id);
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
	validationErrors.push(...forbiddenRuntimeFields(value, "proposal"));
	if (value.kind !== "agentic-memory-record-proposal") {
		validationErrors.push("proposal.kind must be agentic-memory-record-proposal");
	}
	const proposalId = isNonEmptyString(value.proposalId) ? value.proposalId : undefined;
	if (proposalId === undefined) validationErrors.push("proposal.proposalId must be non-empty");
	if (value.targetRecordId !== undefined && !isNonEmptyString(value.targetRecordId)) {
		validationErrors.push("proposal.targetRecordId must be non-empty when present");
	}
	for (const [field, refs] of [
		["sourceRefs", value.sourceRefs],
		["policyRefs", value.policyRefs],
		["evidenceRefs", value.evidenceRefs],
	] as const) {
		if (refs !== undefined) {
			const refErrors = validateFactRefs(refs);
			if (refErrors.length > 0) {
				validationErrors.push(...refErrors.map((error) => `proposal.${field}: ${error}`));
			}
		}
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
	const candidate = validateAndSnapshotRecord<T>(value.candidateRecord, index);
	if (candidate.errors.length > 0 || candidate.record === undefined) {
		validationErrors.push(
			...candidate.errors.flatMap((error) =>
				(error.validationErrors ?? [error.message]).map((message) => `candidateRecord: ${message}`),
			),
		);
	}
	if (validationErrors.length > 0 || proposalId === undefined || candidate.record === undefined) {
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
			candidateRecord: candidate.record,
			...(value.targetRecordId === undefined
				? {}
				: { targetRecordId: value.targetRecordId as FactId }),
			...(value.reason === undefined ? {} : { reason: value.reason as string }),
			...(value.proposalStatus === undefined
				? {}
				: { proposalStatus: value.proposalStatus as string }),
			...(value.sourceRefs === undefined ? {} : { sourceRefs: snapshotFactRefs(value.sourceRefs) }),
			...(value.policyRefs === undefined ? {} : { policyRefs: snapshotFactRefs(value.policyRefs) }),
			...(value.evidenceRefs === undefined
				? {}
				: { evidenceRefs: snapshotFactRefs(value.evidenceRefs) }),
			...(value.idempotencyKey === undefined
				? {}
				: { idempotencyKey: value.idempotencyKey as string }),
			...(value.correlationId === undefined
				? {}
				: { correlationId: value.correlationId as string }),
			...(value.causationId === undefined ? {} : { causationId: value.causationId as string }),
			...(value.metadata === undefined
				? {}
				: { metadata: value.metadata as Readonly<Record<string, StrictJsonValue>> }),
		}),
		issues: [],
	};
}

function admitProposal<T>(
	proposal: AgenticMemoryRecordProposal<T>,
	currentRecordIds: ReadonlySet<FactId>,
	policy: AgenticMemoryRecordAdmissionPolicy,
): AgenticMemoryRecordAdmission<T> {
	const duplicate =
		(policy.rejectDuplicateRecordIds ?? true) &&
		currentRecordIds.has(proposal.candidateRecord.id) &&
		proposal.targetRecordId !== proposal.candidateRecord.id;
	const missingSourceRefs =
		(policy.requireSourceRefs ?? false) && (proposal.sourceRefs?.length ?? 0) === 0;
	const state: AgenticMemoryRecordAdmissionDecisionState = duplicate
		? "rejected"
		: missingSourceRefs
			? "needs-review"
			: (policy.defaultState ?? "needs-review");
	const reason = duplicate
		? "candidate record id already exists"
		: missingSourceRefs
			? "policy requires sourceRefs"
			: (proposal.reason ?? `policy:${policy.policyId}`);
	return Object.freeze({
		kind: "agentic-memory-record-admission",
		admissionId: compoundTupleKey("admission", [policy.policyId, proposal.proposalId]),
		proposalId: proposal.proposalId,
		state,
		candidateRecord: proposal.candidateRecord,
		...(proposal.targetRecordId === undefined ? {} : { targetRecordId: proposal.targetRecordId }),
		reason,
		sourceRefs: mergeRefs([...(proposal.sourceRefs ?? []), ...(policy.sourceRefs ?? [])]),
		policyRefs: mergeRefs([
			...(proposal.policyRefs ?? []),
			{ kind: "agentic-memory-record-admission-policy", id: policy.policyId },
			...(policy.policyRefs ?? []),
		]),
		...(proposal.evidenceRefs === undefined ? {} : { evidenceRefs: proposal.evidenceRefs }),
		...(proposal.idempotencyKey === undefined ? {} : { idempotencyKey: proposal.idempotencyKey }),
		...(proposal.correlationId === undefined ? {} : { correlationId: proposal.correlationId }),
		...(proposal.causationId === undefined ? {} : { causationId: proposal.causationId }),
	});
}

function admissionAudit<T>(
	admission: AgenticMemoryRecordAdmission<T>,
	policy: AgenticMemoryRecordAdmissionPolicy,
): AgenticMemoryRecordAdmissionAuditEntry {
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
	readonly policy: AgenticMemoryRecordAdmissionPolicy;
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
	readonly policy: AgenticMemoryRecordAdmissionPolicy;
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
	validationErrors.push(...forbiddenRuntimeFields(value, "policy"));
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
			validationErrors.push(...validateFactRefs(refs).map((error) => `policy.${field}: ${error}`));
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
				: { defaultState: value.defaultState as AgenticMemoryRecordAdmissionDecisionState }),
			...(value.requireSourceRefs === undefined
				? {}
				: { requireSourceRefs: value.requireSourceRefs as boolean }),
			...(value.rejectDuplicateRecordIds === undefined
				? {}
				: { rejectDuplicateRecordIds: value.rejectDuplicateRecordIds as boolean }),
			...(value.sourceRefs === undefined ? {} : { sourceRefs: snapshotFactRefs(value.sourceRefs) }),
			...(value.policyRefs === undefined ? {} : { policyRefs: snapshotFactRefs(value.policyRefs) }),
			...(value.metadata === undefined
				? {}
				: { metadata: value.metadata as Readonly<Record<string, StrictJsonValue>> }),
		}),
		issues: [],
		invalidPolicies: 0,
	};
}

function validateFactRefs(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return ["must be an array"];
	const length = safeArrayLength(value);
	if (length === undefined) return ["length could not be read"];
	const errors: string[] = [];
	for (let i = 0; i < length; i += 1) {
		if (!Object.hasOwn(value, i)) {
			errors.push(`[${i}] must be present`);
			continue;
		}
		const ref = value[i];
		if (!isPlainRecord(ref)) {
			errors.push(`[${i}] must be an object`);
			continue;
		}
		const extraFields = unexpectedFields(ref, ["id", "kind", "metadata"]);
		if (extraFields.length > 0) {
			errors.push(`[${i}] has unexpected fields ${extraFields.join(",")}`);
		}
		if (!isNonEmptyString(ref.kind)) errors.push(`[${i}].kind must be non-empty`);
		if (!isNonEmptyString(ref.id)) errors.push(`[${i}].id must be non-empty`);
		const forbidden = forbiddenRuntimeFields(ref, `[${i}]`);
		errors.push(...forbidden);
		if (ref.metadata !== undefined && !isStrictJsonObject(ref.metadata)) {
			errors.push(`[${i}].metadata must be a strict JSON object`);
		}
	}
	return errors;
}

function snapshotFactRefs(value: unknown): readonly AgenticMemoryFactRef[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	const refs: AgenticMemoryFactRef[] = [];
	for (let i = 0; i < value.length; i += 1) {
		const ref = value[i] as Record<string, unknown>;
		refs.push(
			Object.freeze({
				kind: ref.kind as string,
				id: ref.id as FactId,
				...(ref.metadata === undefined
					? {}
					: {
							metadata: cloneStrictJsonObject(ref.metadata),
						}),
			}),
		);
	}
	return Object.freeze(refs);
}

function forbiddenRuntimeFields(value: Record<string, unknown>, label: string): readonly string[] {
	const forbidden = [
		"storage",
		"storageTier",
		"storageKey",
		"provider",
		"providerHandle",
		"permission",
		"permissions",
		"graph",
		"node",
		"handle",
		"adapter",
		"hydrate",
		"restore",
		"timer",
		"scheduler",
		"llm",
		"tool",
		"runner",
	] as const;
	const errors: string[] = [];
	for (const field of forbidden) {
		if (Object.hasOwn(value, field)) {
			errors.push(`${label}.${field} is not graph-visible DATA`);
		}
	}
	return errors;
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

function cloneStrictJsonObject(value: unknown): Readonly<Record<string, StrictJsonValue>> {
	const decoded = strictJsonCodec.decode(strictJsonCodec.encode(value)) as StrictJsonValue;
	return deepFreezeStrictJson(decoded) as Readonly<Record<string, StrictJsonValue>>;
}

function deepFreezeStrictJson(value: StrictJsonValue): StrictJsonValue {
	if (value !== null && typeof value === "object") {
		if (Array.isArray(value)) {
			for (const item of value) deepFreezeStrictJson(item);
		} else {
			for (const item of Object.values(value)) deepFreezeStrictJson(item);
		}
		Object.freeze(value);
	}
	return value;
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

function defaultAdmissionPolicy(): AgenticMemoryRecordAdmissionPolicy {
	return Object.freeze({
		kind: "agentic-memory-record-admission-policy",
		policyId: "invalid-policy",
		defaultState: "needs-review",
	});
}

function admissionStatus(
	cursor: AgenticMemoryRecordAdmissionCursor,
): AgenticMemoryRecordAdmissionStatus["state"] {
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
