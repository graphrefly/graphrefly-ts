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
	strictJsonDataErrors,
	validateAgenticMemoryFactRefs,
} from "./shared.js";
import type {
	AgenticMemoryFactRef,
	AgenticMemoryProposalAdmissionDecisionState,
	AgenticMemoryRecordAdmissionPolicy,
	AgenticMemoryRecordAdmissionPolicyCandidate,
	AgenticMemoryRecordAdmissionPolicySourceAuditEntry,
	AgenticMemoryRecordAdmissionPolicySourceBundle,
	AgenticMemoryRecordAdmissionPolicySourceBundleOptions,
	AgenticMemoryRecordAdmissionPolicySourceCursor,
	AgenticMemoryRecordAdmissionPolicySourceKind,
	AgenticMemoryRecordAdmissionPolicySourceProjection,
	AgenticMemoryRecordAdmissionPolicySourceStatus,
	StrictJsonValue,
} from "./types.js";

interface CandidateValidation {
	readonly candidate?: AgenticMemoryRecordAdmissionPolicyCandidate;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryRecordAdmissionPolicySourceAuditEntry[];
}

interface CandidateCollection {
	readonly candidates: readonly AgenticMemoryRecordAdmissionPolicyCandidate[];
	readonly totalSources: number;
	readonly invalidCandidates: number;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryRecordAdmissionPolicySourceAuditEntry[];
	readonly selectedSourceId?: FactId;
	readonly selectedCandidateId?: FactId;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

/**
 * Projects explicit D583 admission policy source DATA into one admission policy.
 *
 * The helper only validates, normalizes, and deterministically selects supplied
 * DATA. It emits no proposal admissions, no application decisions, no record
 * truth, no storage/hydration state, and no provider/runtime or WorkItem
 * authority.
 *
 * @param policySources - Static policy DATA, policy source facts, candidates, or a selection input.
 * @param opts - Optional projection evaluation coordinate.
 * @returns Selected AgenticMemoryRecordAdmissionPolicy plus status/issues/audit/cursor DATA.
 * @category solutions
 * @example
 * ```ts
 * import { projectAgenticMemoryRecordAdmissionPolicySource } from "@graphrefly/ts/solutions/agentic-memory";
 * ```
 */
export function projectAgenticMemoryRecordAdmissionPolicySource(
	policySources: unknown,
	opts: { readonly evaluation?: number } = {},
): AgenticMemoryRecordAdmissionPolicySourceProjection {
	const collection = collectCandidates(policySources);
	const selection = selectCandidate(collection);
	const issues = Object.freeze([...collection.issues, ...selection.issues]);
	const cursor: AgenticMemoryRecordAdmissionPolicySourceCursor = Object.freeze({
		evaluation: opts.evaluation ?? 0,
		sources: collection.totalSources,
		candidates: collection.candidates.length + collection.invalidCandidates,
		validCandidates: collection.candidates.length,
		invalidCandidates: collection.invalidCandidates,
		selectedCandidates: selection.candidate === undefined ? 0 : 1,
		issues: issues.length,
	});
	const audit = Object.freeze([
		...collection.audit,
		...selection.audit,
		...issues.map((issue) =>
			auditEntry("issue-recorded", {
				reason: issue.code,
				...(issue.subjectId === undefined ? {} : { sourceId: issue.subjectId }),
			}),
		),
	]);
	return Object.freeze({
		kind: "agentic-memory-record-admission-policy-source-projection",
		admissionPolicy: selection.candidate?.admissionPolicy ?? fallbackAdmissionPolicy(),
		status: policySourceStatus(cursor),
		issues,
		audit,
		cursor,
	});
}

/**
 * Creates a graph-visible D583 admission policy source projection bundle.
 *
 * The resulting `admissionPolicy` node is ordinary DATA that can feed existing
 * AgenticMemory admission bundles or D587 cross-family composition recipes.
 *
 * @param graph - Graph that owns the created nodes.
 * @param opts - Policy source input node and optional bundle name.
 * @returns Projection node plus admissionPolicy/status/issues/audit/cursor nodes.
 * @category solutions
 * @example
 * ```ts
 * import { agenticMemoryRecordAdmissionPolicySourceBundle } from "@graphrefly/ts/solutions/agentic-memory";
 * ```
 */
export function agenticMemoryRecordAdmissionPolicySourceBundle(
	graph: Graph,
	opts: AgenticMemoryRecordAdmissionPolicySourceBundleOptions,
): AgenticMemoryRecordAdmissionPolicySourceBundle {
	const name = opts.name ?? "agenticMemoryRecordAdmissionPolicySource";
	const projection = graph.node<AgenticMemoryRecordAdmissionPolicySourceProjection>(
		[opts.policySources],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					projectAgenticMemoryRecordAdmissionPolicySource(depLatest(ctx, 0), {
						evaluation: state.evaluation,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryRecordAdmissionPolicySource",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { policySources: opts.policySources },
		projection,
		admissionPolicy: solutionProjection(
			graph,
			projection,
			`${name}/admissionPolicy`,
			"agenticMemoryRecordAdmissionPolicySourcePolicy",
			(fact) => fact.admissionPolicy,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryRecordAdmissionPolicySourceStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryRecordAdmissionPolicySourceIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryRecordAdmissionPolicySourceAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryRecordAdmissionPolicySourceCursor",
			(fact) => fact.cursor,
		),
	};
}

function collectCandidates(value: unknown): CandidateCollection {
	try {
		return collectCandidatesInner(value);
	} catch (error) {
		return {
			candidates: Object.freeze([]),
			totalSources: 0,
			invalidCandidates: 1,
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.admission-policy-source.invalid-input",
					`admission policy source access failed: ${errorMessage(error)}`,
					{ severity: "error" },
				),
			]),
			audit: Object.freeze([]),
		};
	}
}

function collectCandidatesInner(value: unknown): CandidateCollection {
	if (isPlainRecord(value)) {
		const containerErrors = dataRecordContainerErrors(value, "policySourceInput");
		if (containerErrors.length > 0) {
			return {
				candidates: Object.freeze([]),
				totalSources: 0,
				invalidCandidates: 1,
				issues: Object.freeze([
					dataIssue(
						"agentic-memory.admission-policy-source.invalid-input",
						"admission policy source input is not plain DATA",
						{ severity: "error", refs: containerErrors },
					),
				]),
				audit: Object.freeze([]),
			};
		}
		if (value.kind === "agentic-memory-record-admission-policy-selection-input") {
			return collectSelectionInput(value);
		}
		if (value.kind !== "agentic-memory-record-admission-policy") {
			return {
				candidates: Object.freeze([]),
				totalSources: 0,
				invalidCandidates: 1,
				issues: Object.freeze([
					dataIssue(
						"agentic-memory.admission-policy-source.invalid-input",
						"admission policy source object must be a policy or selection input",
						{ severity: "error" },
					),
				]),
				audit: Object.freeze([]),
			};
		}
		const candidate = validateStaticPolicyCandidate(value);
		return collectionFromValidations([candidate], 1);
	}
	if (!Array.isArray(value)) {
		return {
			candidates: Object.freeze([]),
			totalSources: 0,
			invalidCandidates: 1,
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.admission-policy-source.invalid-input",
					"admission policy source input must be a policy object, source array, or selection input",
					{ severity: "error" },
				),
			]),
			audit: Object.freeze([]),
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			candidates: Object.freeze([]),
			totalSources: 0,
			invalidCandidates: 1,
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.admission-policy-source.invalid-input",
					"admission policy source input length could not be read",
					{ severity: "error" },
				),
			]),
			audit: Object.freeze([]),
		};
	}
	const validations: CandidateValidation[] = [];
	let totalSources = 0;
	for (let index = 0; index < length; index += 1) {
		const item = readArrayItem(value, index, "policySource");
		if (item.issues.length > 0) {
			validations.push({
				issues: item.issues,
				audit: Object.freeze(
					item.issues.map((issue) =>
						auditEntry("candidate-invalid", {
							reason: issue.message,
						}),
					),
				),
			});
			continue;
		}
		if (recordKind(item.value) !== "agentic-memory-record-admission-policy-candidate") {
			totalSources += 1;
		}
		validations.push(validateSourceLike(item.value, index));
	}
	return collectionFromValidations(validations, totalSources);
}

function collectSelectionInput(value: Record<string, unknown>): CandidateCollection {
	const validationErrors: string[] = [];
	validationErrors.push(...forbiddenAgenticMemoryDataFields(value, "selectionInput"));
	if (value.selectedSourceId !== undefined && !isNonEmptyString(value.selectedSourceId)) {
		validationErrors.push("selectionInput.selectedSourceId must be non-empty when present");
	}
	if (value.selectedCandidateId !== undefined && !isNonEmptyString(value.selectedCandidateId)) {
		validationErrors.push("selectionInput.selectedCandidateId must be non-empty when present");
	}
	validateOptionalRefs(value.sourceRefs, "selectionInput.sourceRefs", validationErrors);
	validateOptionalRefs(value.policyRefs, "selectionInput.policyRefs", validationErrors);
	const metadata = validateOptionalMetadata(
		value.metadata,
		"selectionInput.metadata",
		validationErrors,
	);
	if (validationErrors.length > 0) {
		return {
			candidates: Object.freeze([]),
			totalSources: 0,
			invalidCandidates: 1,
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.admission-policy-source.selection-input-invalid",
					"admission policy selection input is invalid",
					{ severity: "error", refs: validationErrors },
				),
			]),
			audit: Object.freeze([]),
		};
	}
	const sourceRefs = snapshotOptionalRefs(value.sourceRefs);
	const policyRefs = snapshotOptionalRefs(value.policyRefs);
	const validations: CandidateValidation[] = [];
	let totalSources = 0;
	if (value.sources !== undefined) {
		if (!Array.isArray(value.sources)) {
			validations.push(invalidCandidate(0, "selectionInput.sources must be an array"));
		} else {
			const length = safeArrayLength(value.sources);
			if (length === undefined) {
				validations.push(invalidCandidate(0, "selectionInput.sources length could not be read"));
			} else {
				totalSources += length;
				for (let index = 0; index < length; index += 1) {
					const item = readArrayItem(value.sources, index, "selectionInput.sources");
					if (item.issues.length > 0) {
						validations.push({
							issues: item.issues,
							audit: Object.freeze(
								item.issues.map((issue) =>
									auditEntry("candidate-invalid", { reason: issue.message }),
								),
							),
						});
						continue;
					}
					validations.push(validateSourceLike(item.value, index));
				}
			}
		}
	}
	if (value.candidates !== undefined) {
		if (!Array.isArray(value.candidates)) {
			validations.push(invalidCandidate(0, "selectionInput.candidates must be an array"));
		} else {
			const length = safeArrayLength(value.candidates);
			if (length === undefined) {
				validations.push(invalidCandidate(0, "selectionInput.candidates length could not be read"));
			} else {
				for (let index = 0; index < length; index += 1) {
					const item = readArrayItem(value.candidates, index, "selectionInput.candidates");
					if (item.issues.length > 0) {
						validations.push({
							issues: item.issues,
							audit: Object.freeze(
								item.issues.map((issue) =>
									auditEntry("candidate-invalid", { reason: issue.message }),
								),
							),
						});
						continue;
					}
					validations.push(validateCandidate(item.value, index));
				}
			}
		}
	}
	const collection = collectionFromValidations(validations, totalSources);
	return {
		...collection,
		candidates: Object.freeze(
			collection.candidates.map((candidate) =>
				enrichCandidate(candidate, sourceRefs, policyRefs, metadata),
			),
		),
		selectedSourceId: value.selectedSourceId as FactId | undefined,
		selectedCandidateId: value.selectedCandidateId as FactId | undefined,
		...(sourceRefs.length === 0 ? {} : { sourceRefs }),
		...(policyRefs.length === 0 ? {} : { policyRefs }),
		...(metadata === undefined ? {} : { metadata }),
	};
}

function validateSourceLike(value: unknown, index: number): CandidateValidation {
	if (!isPlainRecord(value)) return invalidCandidate(index, "policy source must be an object");
	const containerErrors = dataRecordContainerErrors(value, "policySource");
	if (containerErrors.length > 0) {
		return invalidCandidate(index, "policy source must be plain DATA", { refs: containerErrors });
	}
	if (value.kind === "agentic-memory-record-admission-policy") {
		return validateStaticPolicyCandidate(value, index);
	}
	if (value.kind === "agentic-memory-record-admission-policy-candidate") {
		return validateCandidate(value, index);
	}
	return validateSource(value, index);
}

function validateSource(value: unknown, index: number): CandidateValidation {
	if (!isPlainRecord(value)) return invalidCandidate(index, "policy source must be an object");
	const containerErrors = dataRecordContainerErrors(value, "policySource");
	if (containerErrors.length > 0) {
		return invalidCandidate(index, "policy source must be plain DATA", { refs: containerErrors });
	}
	const validationErrors: string[] = [];
	validationErrors.push(...forbiddenAgenticMemoryDataFields(value, "policySource"));
	if (value.kind !== "agentic-memory-record-admission-policy-source") {
		validationErrors.push(
			"policySource.kind must be agentic-memory-record-admission-policy-source",
		);
	}
	const sourceId = isNonEmptyString(value.sourceId) ? value.sourceId : undefined;
	if (sourceId === undefined) validationErrors.push("policySource.sourceId must be non-empty");
	const sourceKind = isNonEmptyString(value.sourceKind) ? value.sourceKind : undefined;
	if (sourceKind === undefined) validationErrors.push("policySource.sourceKind must be non-empty");
	const priority = validatePriority(value.priority, "policySource.priority", validationErrors);
	validateOptionalRefs(value.sourceRefs, "policySource.sourceRefs", validationErrors);
	validateOptionalRefs(value.policyRefs, "policySource.policyRefs", validationErrors);
	const metadata = validateOptionalMetadata(
		value.metadata,
		"policySource.metadata",
		validationErrors,
	);
	const material = validatePolicyMaterial(
		value.material,
		index,
		sourceId,
		sourceKind,
		priority,
		value.sourceRefs,
		value.policyRefs,
		metadata,
	);
	validationErrors.push(...material.issues.flatMap((issue) => issue.refs ?? [issue.message]));
	if (
		validationErrors.length > 0 ||
		sourceId === undefined ||
		sourceKind === undefined ||
		material.candidate === undefined
	) {
		return invalidCandidate(index, "admission policy source is invalid", {
			subjectId: sourceId,
			refs: validationErrors,
		});
	}
	return material;
}

function validatePolicyMaterial(
	value: unknown,
	index: number,
	sourceId: FactId | undefined,
	sourceKind: string | undefined,
	priority: number | undefined,
	sourceRefs: unknown,
	policyRefs: unknown,
	sourceMetadata: Readonly<Record<string, StrictJsonValue>> | undefined,
): CandidateValidation {
	if (!isPlainRecord(value)) {
		return invalidCandidate(index, "policy material must be an object", { subjectId: sourceId });
	}
	const containerErrors = dataRecordContainerErrors(value, "policyMaterial");
	if (containerErrors.length > 0) {
		return invalidCandidate(index, "policy material must be plain DATA", {
			subjectId: sourceId,
			refs: containerErrors,
		});
	}
	if (value.kind === "agentic-memory-record-admission-policy") {
		return validateCandidateFromPolicy({
			index,
			sourceId,
			sourceKind,
			priority,
			policyValue: value,
			sourceRefs,
			policyRefs,
			metadata: sourceMetadata,
		});
	}
	const validationErrors: string[] = [];
	validationErrors.push(...forbiddenAgenticMemoryDataFields(value, "policyMaterial"));
	if (value.kind !== "agentic-memory-record-admission-policy-material") {
		validationErrors.push(
			"policyMaterial.kind must be agentic-memory-record-admission-policy-material",
		);
	}
	validateOptionalRefs(value.sourceRefs, "policyMaterial.sourceRefs", validationErrors);
	validateOptionalRefs(value.policyRefs, "policyMaterial.policyRefs", validationErrors);
	const metadata = validateOptionalMetadata(
		value.metadata,
		"policyMaterial.metadata",
		validationErrors,
	);
	if (validationErrors.length > 0) {
		return invalidCandidate(index, "admission policy material is invalid", {
			subjectId: sourceId,
			refs: validationErrors,
		});
	}
	return validateCandidateFromPolicy({
		index,
		sourceId,
		sourceKind,
		priority,
		policyValue: value.admissionPolicy,
		sourceRefs: mergeRefsUnknown(sourceRefs, value.sourceRefs),
		policyRefs: mergeRefsUnknown(policyRefs, value.policyRefs),
		metadata: mergeMetadata(sourceMetadata, metadata),
	});
}

function validateStaticPolicyCandidate(value: unknown, index = 0): CandidateValidation {
	const policyId =
		isPlainRecord(value) && isNonEmptyString(value.policyId) ? value.policyId : "static";
	return validateCandidateFromPolicy({
		index,
		sourceId: "static",
		sourceKind: "static",
		priority: 0,
		policyValue: value,
		sourceRefs: [{ kind: "agentic-memory-record-admission-policy-source", id: "static" }],
		policyRefs: [{ kind: "agentic-memory-record-admission-policy", id: policyId }],
	});
}

function validateCandidate(value: unknown, index: number): CandidateValidation {
	if (!isPlainRecord(value)) return invalidCandidate(index, "policy candidate must be an object");
	const containerErrors = dataRecordContainerErrors(value, "policyCandidate");
	if (containerErrors.length > 0) {
		return invalidCandidate(index, "policy candidate must be plain DATA", {
			refs: containerErrors,
		});
	}
	const validationErrors: string[] = [];
	validationErrors.push(...forbiddenAgenticMemoryDataFields(value, "policyCandidate"));
	if (value.kind !== "agentic-memory-record-admission-policy-candidate") {
		validationErrors.push(
			"policyCandidate.kind must be agentic-memory-record-admission-policy-candidate",
		);
	}
	const candidateId = isNonEmptyString(value.candidateId) ? value.candidateId : undefined;
	if (candidateId === undefined)
		validationErrors.push("policyCandidate.candidateId must be non-empty");
	const sourceId = isNonEmptyString(value.sourceId) ? value.sourceId : undefined;
	if (sourceId === undefined) validationErrors.push("policyCandidate.sourceId must be non-empty");
	const sourceKind = isNonEmptyString(value.sourceKind) ? value.sourceKind : undefined;
	if (sourceKind === undefined)
		validationErrors.push("policyCandidate.sourceKind must be non-empty");
	const priority = validatePriority(value.priority, "policyCandidate.priority", validationErrors);
	validateOptionalRefs(value.sourceRefs, "policyCandidate.sourceRefs", validationErrors);
	validateOptionalRefs(value.policyRefs, "policyCandidate.policyRefs", validationErrors);
	const metadata = validateOptionalMetadata(
		value.metadata,
		"policyCandidate.metadata",
		validationErrors,
	);
	const policy = validateAdmissionPolicy(value.admissionPolicy);
	validationErrors.push(...policy.errors);
	if (
		validationErrors.length > 0 ||
		candidateId === undefined ||
		sourceId === undefined ||
		sourceKind === undefined ||
		policy.policy === undefined
	) {
		return invalidCandidate(index, "admission policy candidate is invalid", {
			subjectId: candidateId ?? sourceId,
			refs: validationErrors,
		});
	}
	return {
		candidate: freezeCandidate({
			candidateId,
			sourceId,
			sourceKind,
			priority,
			admissionPolicy: mergePolicyRefs(policy.policy, value.sourceRefs, value.policyRefs),
			sourceRefs: snapshotOptionalRefs(value.sourceRefs),
			policyRefs: snapshotOptionalRefs(value.policyRefs),
			metadata,
		}),
		issues: [],
		audit: [],
	};
}

function validateCandidateFromPolicy(opts: {
	readonly index: number;
	readonly sourceId: FactId | undefined;
	readonly sourceKind: string | undefined;
	readonly priority: number | undefined;
	readonly policyValue: unknown;
	readonly sourceRefs?: unknown;
	readonly policyRefs?: unknown;
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}): CandidateValidation {
	const policy = validateAdmissionPolicy(opts.policyValue);
	if (policy.policy === undefined || opts.sourceId === undefined || opts.sourceKind === undefined) {
		return invalidCandidate(opts.index, "admission policy material is invalid", {
			subjectId: opts.sourceId,
			refs: policy.errors,
		});
	}
	const candidateId = compoundTupleKey("agentic-memory-record-admission-policy-candidate", [
		opts.sourceId,
		policy.policy.policyId,
	]);
	return {
		candidate: freezeCandidate({
			candidateId,
			sourceId: opts.sourceId,
			sourceKind: opts.sourceKind,
			priority: opts.priority,
			admissionPolicy: mergePolicyRefs(policy.policy, opts.sourceRefs, opts.policyRefs),
			sourceRefs: snapshotOptionalRefs(opts.sourceRefs),
			policyRefs: snapshotOptionalRefs(opts.policyRefs),
			metadata: opts.metadata,
		}),
		issues: [],
		audit: [],
	};
}

function validateAdmissionPolicy(value: unknown): {
	readonly policy?: AgenticMemoryRecordAdmissionPolicy;
	readonly errors: readonly string[];
} {
	if (!isPlainRecord(value)) return { errors: ["admissionPolicy must be an object"] };
	const containerErrors = dataRecordContainerErrors(value, "admissionPolicy");
	if (containerErrors.length > 0) return { errors: containerErrors };
	const validationErrors: string[] = [];
	validationErrors.push(...forbiddenAgenticMemoryDataFields(value, "admissionPolicy"));
	if (value.kind !== "agentic-memory-record-admission-policy") {
		validationErrors.push("admissionPolicy.kind must be agentic-memory-record-admission-policy");
	}
	const policyId = isNonEmptyString(value.policyId) ? value.policyId : undefined;
	if (policyId === undefined) validationErrors.push("admissionPolicy.policyId must be non-empty");
	if (
		value.defaultState !== undefined &&
		value.defaultState !== "admitted" &&
		value.defaultState !== "rejected" &&
		value.defaultState !== "needs-review"
	) {
		validationErrors.push(
			"admissionPolicy.defaultState must be admitted, rejected, or needs-review",
		);
	}
	for (const field of ["requireSourceRefs", "rejectDuplicateRecordIds"]) {
		if (value[field] !== undefined && typeof value[field] !== "boolean") {
			validationErrors.push(`admissionPolicy.${field} must be boolean when present`);
		}
	}
	validateOptionalRefs(value.sourceRefs, "admissionPolicy.sourceRefs", validationErrors);
	validateOptionalRefs(value.policyRefs, "admissionPolicy.policyRefs", validationErrors);
	const metadata = validateOptionalMetadata(
		value.metadata,
		"admissionPolicy.metadata",
		validationErrors,
	);
	if (validationErrors.length > 0 || policyId === undefined) {
		return { errors: validationErrors };
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
			...(metadata === undefined ? {} : { metadata }),
		}),
		errors: [],
	};
}

function selectCandidate(collection: CandidateCollection): {
	readonly candidate?: AgenticMemoryRecordAdmissionPolicyCandidate;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryRecordAdmissionPolicySourceAuditEntry[];
} {
	const audit: AgenticMemoryRecordAdmissionPolicySourceAuditEntry[] = [];
	if (collection.candidates.length === 0) return { issues: [], audit: Object.freeze(audit) };
	const duplicate = duplicateCandidateIdentity(collection.candidates);
	if (duplicate !== undefined) {
		return {
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.admission-policy-source.duplicate-candidate",
					"multiple admission policy candidates share the same candidateId",
					{ severity: "error", refs: duplicate.refs },
				),
			]),
			audit: Object.freeze([
				auditEntry("selection-blocked", {
					candidateId: duplicate.candidateId,
					reason: "duplicate-candidate",
				}),
			]),
		};
	}
	const explicitlySelected = explicitSelection(collection);
	if (explicitlySelected !== undefined) return explicitlySelected;
	const sorted = [...collection.candidates].sort((a, b) => {
		const aPriority = a.priority ?? 0;
		const bPriority = b.priority ?? 0;
		if (aPriority !== bPriority) return aPriority - bPriority;
		return a.candidateId.localeCompare(b.candidateId);
	});
	const selected = sorted[0];
	if (selected === undefined) return { issues: [], audit: Object.freeze(audit) };
	const samePriority = sorted.filter(
		(candidate) => (candidate.priority ?? 0) === (selected.priority ?? 0),
	);
	if (samePriority.length > 1) {
		const refs = samePriority.map((candidate) => candidate.candidateId);
		return {
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.admission-policy-source.ambiguous-selection",
					"multiple admission policy candidates share the selected priority",
					{ severity: "error", refs },
				),
			]),
			audit: Object.freeze([
				auditEntry("selection-blocked", {
					reason: "ambiguous-priority",
					priority: selected.priority ?? 0,
				}),
			]),
		};
	}
	return {
		candidate: selected,
		issues: [],
		audit: Object.freeze([
			auditEntry("candidate-selected", {
				sourceId: selected.sourceId,
				candidateId: selected.candidateId,
				policyId: selected.admissionPolicy.policyId,
				priority: selected.priority,
				reason: "lowest-priority",
				sourceRefs: selected.sourceRefs,
				policyRefs: selected.policyRefs,
				metadata: selected.metadata,
			}),
		]),
	};
}

function explicitSelection(collection: CandidateCollection):
	| {
			readonly candidate?: AgenticMemoryRecordAdmissionPolicyCandidate;
			readonly issues: readonly DataIssue[];
			readonly audit: readonly AgenticMemoryRecordAdmissionPolicySourceAuditEntry[];
	  }
	| undefined {
	const { selectedCandidateId, selectedSourceId } = collection;
	if (selectedCandidateId === undefined && selectedSourceId === undefined) return undefined;
	const matches = collection.candidates.filter(
		(candidate) =>
			(selectedCandidateId === undefined || candidate.candidateId === selectedCandidateId) &&
			(selectedSourceId === undefined || candidate.sourceId === selectedSourceId),
	);
	if (matches.length !== 1) {
		return {
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.admission-policy-source.explicit-selection-missing",
					"explicit admission policy selection did not match exactly one candidate",
					{
						severity: "error",
						refs: [
							...(selectedCandidateId === undefined ? [] : [selectedCandidateId]),
							...(selectedSourceId === undefined ? [] : [selectedSourceId]),
						],
					},
				),
			]),
			audit: Object.freeze([
				auditEntry("selection-blocked", {
					sourceId: selectedSourceId,
					candidateId: selectedCandidateId,
					reason: "explicit-selection-missing",
				}),
			]),
		};
	}
	const selected = matches[0] as AgenticMemoryRecordAdmissionPolicyCandidate;
	return {
		candidate: selected,
		issues: [],
		audit: Object.freeze([
			auditEntry("candidate-selected", {
				sourceId: selected.sourceId,
				candidateId: selected.candidateId,
				policyId: selected.admissionPolicy.policyId,
				priority: selected.priority,
				reason: "explicit-selection",
				sourceRefs: selected.sourceRefs,
				policyRefs: selected.policyRefs,
				metadata: selected.metadata,
			}),
		]),
	};
}

function duplicateCandidateIdentity(
	candidates: readonly AgenticMemoryRecordAdmissionPolicyCandidate[],
): { readonly candidateId: FactId; readonly refs: readonly string[] } | undefined {
	const seen = new Map<string, AgenticMemoryRecordAdmissionPolicyCandidate>();
	for (const candidate of candidates) {
		const previous = seen.get(candidate.candidateId);
		if (previous !== undefined) {
			return {
				candidateId: candidate.candidateId,
				refs: Object.freeze([
					previous.candidateId,
					candidate.candidateId,
					previous.sourceId,
					candidate.sourceId,
				]),
			};
		}
		seen.set(candidate.candidateId, candidate);
	}
	return undefined;
}

function collectionFromValidations(
	validations: readonly CandidateValidation[],
	totalSources: number,
): CandidateCollection {
	const candidates: AgenticMemoryRecordAdmissionPolicyCandidate[] = [];
	const issues: DataIssue[] = [];
	const audit: AgenticMemoryRecordAdmissionPolicySourceAuditEntry[] = [];
	let invalidCandidates = 0;
	for (const validation of validations) {
		if (validation.candidate === undefined) invalidCandidates += 1;
		else candidates.push(validation.candidate);
		issues.push(...validation.issues);
		audit.push(...validation.audit);
	}
	return {
		candidates: Object.freeze(candidates),
		totalSources,
		invalidCandidates,
		issues: Object.freeze(issues),
		audit: Object.freeze(audit),
	};
}

function invalidCandidate(
	index: number,
	reason: string,
	opts: { readonly subjectId?: string; readonly refs?: readonly string[] } = {},
): CandidateValidation {
	return {
		issues: Object.freeze([
			dataIssue("agentic-memory.admission-policy-source.candidate-invalid", reason, {
				severity: "error",
				subjectId: opts.subjectId,
				path: [index],
				refs: opts.refs,
			}),
		]),
		audit: Object.freeze([
			auditEntry("candidate-invalid", {
				sourceId: opts.subjectId,
				reason,
			}),
		]),
	};
}

function freezeCandidate(input: {
	readonly candidateId: FactId;
	readonly sourceId: FactId;
	readonly sourceKind: string;
	readonly priority?: number;
	readonly admissionPolicy: AgenticMemoryRecordAdmissionPolicy;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}): AgenticMemoryRecordAdmissionPolicyCandidate {
	return Object.freeze({
		kind: "agentic-memory-record-admission-policy-candidate",
		candidateId: input.candidateId,
		sourceId: input.sourceId,
		sourceKind: input.sourceKind as AgenticMemoryRecordAdmissionPolicySourceKind,
		...(input.priority === undefined ? {} : { priority: input.priority }),
		admissionPolicy: input.admissionPolicy,
		...(input.sourceRefs === undefined ? {} : { sourceRefs: input.sourceRefs }),
		...(input.policyRefs === undefined ? {} : { policyRefs: input.policyRefs }),
		...(input.metadata === undefined ? {} : { metadata: input.metadata }),
	});
}

function mergePolicyRefs(
	policy: AgenticMemoryRecordAdmissionPolicy,
	sourceRefs: unknown,
	policyRefs: unknown,
): AgenticMemoryRecordAdmissionPolicy {
	const mergedSourceRefs = mergeRefs([
		...(policy.sourceRefs ?? []),
		...snapshotOptionalRefs(sourceRefs),
	]);
	const mergedPolicyRefs = mergeRefs([
		...(policy.policyRefs ?? []),
		...snapshotOptionalRefs(policyRefs),
		{ kind: "agentic-memory-record-admission-policy", id: policy.policyId },
	]);
	return Object.freeze({
		...policy,
		...(mergedSourceRefs.length === 0 ? {} : { sourceRefs: mergedSourceRefs }),
		...(mergedPolicyRefs.length === 0 ? {} : { policyRefs: mergedPolicyRefs }),
	});
}

function enrichCandidate(
	candidate: AgenticMemoryRecordAdmissionPolicyCandidate,
	sourceRefs: readonly AgenticMemoryFactRef[],
	policyRefs: readonly AgenticMemoryFactRef[],
	metadata: Readonly<Record<string, StrictJsonValue>> | undefined,
): AgenticMemoryRecordAdmissionPolicyCandidate {
	const mergedSourceRefs = mergeRefs([...(candidate.sourceRefs ?? []), ...sourceRefs]);
	const mergedPolicyRefs = mergeRefs([...(candidate.policyRefs ?? []), ...policyRefs]);
	const mergedMetadata = mergeMetadata(metadata, candidate.metadata);
	return freezeCandidate({
		candidateId: candidate.candidateId,
		sourceId: candidate.sourceId,
		sourceKind: candidate.sourceKind,
		priority: candidate.priority,
		admissionPolicy: mergePolicyRefs(candidate.admissionPolicy, mergedSourceRefs, mergedPolicyRefs),
		sourceRefs: mergedSourceRefs,
		policyRefs: mergedPolicyRefs,
		metadata: mergedMetadata,
	});
}

function mergeMetadata(
	base: Readonly<Record<string, StrictJsonValue>> | undefined,
	overlay: Readonly<Record<string, StrictJsonValue>> | undefined,
): Readonly<Record<string, StrictJsonValue>> | undefined {
	if (base === undefined && overlay === undefined) return undefined;
	return Object.freeze({ ...(base ?? {}), ...(overlay ?? {}) });
}

function mergeRefs(refs: readonly AgenticMemoryFactRef[]): readonly AgenticMemoryFactRef[] {
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

function mergeRefsUnknown(
	first: unknown,
	second: unknown,
): readonly AgenticMemoryFactRef[] | undefined {
	const refs = mergeRefs([...snapshotOptionalRefs(first), ...snapshotOptionalRefs(second)]);
	return refs.length === 0 ? undefined : refs;
}

function readArrayItem(
	value: readonly unknown[],
	index: number,
	label: string,
): { readonly value?: unknown; readonly issues: readonly DataIssue[] } {
	if (!Object.hasOwn(value, index)) {
		return {
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.admission-policy-source.candidate-invalid",
					`${label}[${index}] must be present`,
					{ severity: "error", path: [index] },
				),
			]),
		};
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
	if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
		return {
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.admission-policy-source.candidate-invalid",
					`${label}[${index}] must be a data property`,
					{ severity: "error", path: [index] },
				),
			]),
		};
	}
	if (!descriptor.enumerable) {
		return {
			issues: Object.freeze([
				dataIssue(
					"agentic-memory.admission-policy-source.candidate-invalid",
					`${label}[${index}] must be enumerable`,
					{ severity: "error", path: [index] },
				),
			]),
		};
	}
	return { value: descriptor.value, issues: Object.freeze([]) };
}

function snapshotOptionalRefs(value: unknown): readonly AgenticMemoryFactRef[] {
	if (value === undefined) return Object.freeze([]);
	return snapshotAgenticMemoryFactRefs(value);
}

function validateOptionalRefs(value: unknown, label: string, errors: string[]): void {
	if (value === undefined) return;
	errors.push(...validateAgenticMemoryFactRefs(value).map((error) => `${label}: ${error}`));
}

function validateOptionalMetadata(
	value: unknown,
	label: string,
	errors: string[],
): Readonly<Record<string, StrictJsonValue>> | undefined {
	if (value === undefined) return undefined;
	if (!isPlainRecord(value)) {
		errors.push(`${label} must be a strict JSON object`);
		return undefined;
	}
	const dataErrors = strictJsonDataErrors(value, label);
	if (dataErrors.length > 0 || !isStrictJsonObject(value)) {
		errors.push(
			...(dataErrors.length > 0 ? dataErrors : [`${label} must be a strict JSON object`]),
		);
		return undefined;
	}
	return cloneStrictJsonObject(value);
}

function validatePriority(value: unknown, label: string, errors: string[]): number | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		!Number.isFinite(value) ||
		!Number.isSafeInteger(value)
	) {
		errors.push(`${label} must be a finite safe integer when present`);
		return undefined;
	}
	return value;
}

function recordKind(value: unknown): string | undefined {
	if (!isPlainRecord(value)) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
	if (descriptor === undefined || "get" in descriptor || "set" in descriptor) return undefined;
	return typeof descriptor.value === "string" ? descriptor.value : undefined;
}

function policySourceStatus(
	cursor: AgenticMemoryRecordAdmissionPolicySourceCursor,
): AgenticMemoryRecordAdmissionPolicySourceStatus {
	const state: AgenticMemoryRecordAdmissionPolicySourceStatus["state"] =
		cursor.selectedCandidates > 0 && cursor.issues === 0
			? "ready"
			: cursor.selectedCandidates > 0
				? "partial"
				: cursor.validCandidates === 0
					? cursor.candidates === 0 && cursor.issues === 0
						? "empty"
						: "error"
					: "blocked";
	return Object.freeze({ state, cursor });
}

function fallbackAdmissionPolicy(): AgenticMemoryRecordAdmissionPolicy {
	return Object.freeze({
		kind: "agentic-memory-record-admission-policy",
		policyId: "invalid-admission-policy-source",
		defaultState: "rejected",
		policyRefs: Object.freeze([
			Object.freeze({ kind: "agentic-memory-record-admission-policy-source", id: "invalid" }),
		]),
	});
}

function auditEntry(
	action: AgenticMemoryRecordAdmissionPolicySourceAuditEntry["action"],
	opts: Omit<AgenticMemoryRecordAdmissionPolicySourceAuditEntry, "kind" | "action"> = {},
): AgenticMemoryRecordAdmissionPolicySourceAuditEntry {
	return Object.freeze({
		kind: "agentic-memory-record-admission-policy-source-audit",
		action,
		...opts,
	});
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
