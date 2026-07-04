import { depLatest } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../../identity.js";
import { stableJsonString, strictJsonCodec } from "../../json/codec.js";
import type { Node } from "../../node/node.js";
import type { EffectRunResult, SourceRef } from "../../orchestration/agent-runtime.js";
import type { WorkItemEvidenceRecorded } from "../../orchestration/work-item-runtime.js";
import type { ScoreRef, ScoreSignal } from "../../scoring/index.js";
import { agenticMemoryRecordFrame } from "../agentic-memory/frame.js";
import { solutionProjection } from "../agentic-memory/projection.js";
import {
	cloneStrictJsonObject,
	isNonEmptyString,
	snapshotAgenticMemoryFactRefs,
	validateAgenticMemoryFactRefs,
} from "../agentic-memory/shared.js";
import type {
	AgenticMemoryFactRef,
	AgenticMemoryRecord,
	AgenticMemoryRecordApplicationOperation,
	AgenticMemoryRecordCandidateMaterial,
	AgenticMemoryRecordProposal,
	StrictJsonValue,
} from "../agentic-memory/types.js";
import type { WorkItemProjection } from "../work-item/index.js";
import type {
	AgenticWorkItemMemoryBridgeAuditEntry,
	AgenticWorkItemMemoryBridgeBundle,
	AgenticWorkItemMemoryBridgeBundleOptions,
	AgenticWorkItemMemoryBridgeInput,
	AgenticWorkItemMemoryBridgeIssue,
	AgenticWorkItemMemoryBridgeResult,
	AgenticWorkItemMemoryBridgeStatus,
	AgenticWorkItemMemoryBridgeStatusState,
	AgenticWorkItemMemoryContextFact,
	AgenticWorkItemMemoryDataSelector,
	AgenticWorkItemMemoryMappingPolicy,
	AgenticWorkItemMemoryRecordCandidate,
	AgenticWorkItemMemoryRecordMappingRule,
	AgenticWorkItemMemoryScoreMappingRule,
} from "./types.js";

type CandidateOrigin = "generated" | "explicit";

interface CandidateDraft<T> {
	readonly origin: CandidateOrigin;
	readonly candidateId: string;
	readonly workItemId: string;
	readonly coordinate: string;
	readonly materialIdentity: string;
	readonly proposal: AgenticMemoryRecordProposal<T>;
	readonly coordinateSourceRefs: readonly AgenticMemoryFactRef[];
	readonly sourceRefs: readonly AgenticMemoryFactRef[];
	readonly policyRefs: readonly AgenticMemoryFactRef[];
	readonly evidenceRefs: readonly AgenticMemoryFactRef[];
}

interface BridgeInputs<TInput> {
	readonly workItem: WorkItemProjection<TInput>;
	readonly evidence: readonly WorkItemEvidenceRecorded[];
	readonly outcomes: readonly EffectRunResult[];
	readonly context: readonly AgenticWorkItemMemoryContextFact[];
}

interface SelectedValue {
	readonly value?: unknown;
	readonly sourceRefs: readonly AgenticMemoryFactRef[];
	readonly policyRefs: readonly AgenticMemoryFactRef[];
}

interface MaterialSelection<T> {
	readonly material?: AgenticMemoryRecordCandidateMaterial<T>;
	readonly sourceRefs: readonly AgenticMemoryFactRef[];
	readonly policyRefs: readonly AgenticMemoryFactRef[];
}

const OPERATIONS = ["create", "replace", "update"] as const;
const FORBIDDEN_POLICY_KEYS = new Set([
	"callback",
	"mapper",
	"providerHandle",
	"runtimeHandle",
	"storageHandle",
	"graphHandle",
	"nodeHandle",
	"permissionAuthority",
	"hydration",
	"replay",
	"admissionAuthority",
	"applicationAuthority",
	"mutationDsl",
	"genericMutationDsl",
]);

/**
 * Creates a DATA-only WorkItem to AgenticMemory mapper bridge bundle (D581/D582).
 *
 * @param graph - Graph that owns the created nodes.
 * @param opts - Nodes carrying current WorkItem projection, mapping policy, and optional DATA inputs.
 * @returns Bridge projection nodes for score signals, proposals, and bridge-local read models.
 * @category solutions
 * @example
 * ```ts
 * import { agenticWorkItemMemoryBridgeBundle } from "@graphrefly/ts/solutions/agentic-work-item-memory";
 * ```
 */
export function agenticWorkItemMemoryBridgeBundle<TInput = unknown, TRecord = unknown>(
	graph: Graph,
	opts: AgenticWorkItemMemoryBridgeBundleOptions<TInput, TRecord>,
): AgenticWorkItemMemoryBridgeBundle<TInput, TRecord> {
	const name = opts.name ?? "agenticWorkItemMemoryBridge";
	const deps: Node<unknown>[] = [opts.workItem as Node<unknown>, opts.policy as Node<unknown>];
	if (opts.evidence !== undefined) deps.push(opts.evidence as Node<unknown>);
	if (opts.outcomes !== undefined) deps.push(opts.outcomes as Node<unknown>);
	if (opts.context !== undefined) deps.push(opts.context as Node<unknown>);
	if (opts.candidates !== undefined) deps.push(opts.candidates as Node<unknown>);
	const evidenceIndex = opts.evidence === undefined ? -1 : 2;
	const outcomesIndex =
		opts.outcomes === undefined ? -1 : 2 + (opts.evidence === undefined ? 0 : 1);
	const contextIndex =
		opts.context === undefined
			? -1
			: 2 + (opts.evidence === undefined ? 0 : 1) + (opts.outcomes === undefined ? 0 : 1);
	const candidatesIndex =
		opts.candidates === undefined
			? -1
			: 2 +
				(opts.evidence === undefined ? 0 : 1) +
				(opts.outcomes === undefined ? 0 : 1) +
				(opts.context === undefined ? 0 : 1);
	const projection = graph.node<AgenticWorkItemMemoryBridgeResult<TRecord>>(
		deps,
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const result = mapAgenticWorkItemMemoryBridge<TInput, TRecord>({
				workItem: depLatest(ctx, 0) as WorkItemProjection<TInput>,
				policy: depLatest(ctx, 1) as AgenticWorkItemMemoryMappingPolicy<TRecord>,
				evidence:
					evidenceIndex < 0
						? undefined
						: (depLatest(ctx, evidenceIndex) as readonly WorkItemEvidenceRecorded[] | undefined),
				outcomes:
					outcomesIndex < 0
						? undefined
						: (depLatest(ctx, outcomesIndex) as readonly EffectRunResult[] | undefined),
				context:
					contextIndex < 0
						? undefined
						: (depLatest(ctx, contextIndex) as
								| readonly AgenticWorkItemMemoryContextFact[]
								| undefined),
				candidates:
					candidatesIndex < 0
						? undefined
						: (depLatest(ctx, candidatesIndex) as
								| readonly AgenticWorkItemMemoryRecordCandidate<TRecord>[]
								| undefined),
				evaluation: state.evaluation,
			});
			ctx.state.set(state);
			ctx.down([["DATA", result]]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticWorkItemMemoryBridge",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: {
			workItem: opts.workItem,
			policy: opts.policy,
			...(opts.evidence === undefined ? {} : { evidence: opts.evidence }),
			...(opts.outcomes === undefined ? {} : { outcomes: opts.outcomes }),
			...(opts.context === undefined ? {} : { context: opts.context }),
			...(opts.candidates === undefined ? {} : { candidates: opts.candidates }),
		},
		projection,
		scoreSignals: solutionProjection(
			graph,
			projection,
			`${name}/scoreSignals`,
			"agenticWorkItemMemoryBridgeScoreSignals",
			(fact) => fact.scoreSignals,
		),
		proposals: solutionProjection(
			graph,
			projection,
			`${name}/proposals`,
			"agenticWorkItemMemoryBridgeProposals",
			(fact) => fact.proposals,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticWorkItemMemoryBridgeStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticWorkItemMemoryBridgeIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticWorkItemMemoryBridgeAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticWorkItemMemoryBridgeCursor",
			(fact) => fact.cursor,
		),
	};
}

/**
 * Maps WorkItem DATA into generic ScoreSignal and AgenticMemoryRecordProposal facts.
 *
 * This helper is pure and mapper-only: it does not admit proposals, apply record
 * truth, mutate WorkItems, call providers, touch storage, or hydrate records.
 *
 * @param input - Current WorkItem projection, DATA policy, and optional bridge inputs.
 * @returns Bridge result with generic outputs and bridge-local read models.
 * @category solutions
 * @example
 * ```ts
 * import { mapAgenticWorkItemMemoryBridge } from "@graphrefly/ts/solutions/agentic-work-item-memory";
 * ```
 */
export function mapAgenticWorkItemMemoryBridge<TInput = unknown, TRecord = unknown>(
	input: AgenticWorkItemMemoryBridgeInput<TInput, TRecord>,
): AgenticWorkItemMemoryBridgeResult<TRecord> {
	const issues: AgenticWorkItemMemoryBridgeIssue[] = [];
	const audit: AgenticWorkItemMemoryBridgeAuditEntry[] = [];
	const scoreSignals: ScoreSignal[] = [];
	const candidates: CandidateDraft<TRecord>[] = [];
	const policyIssues = validatePolicy(input.policy);
	const workItemIssues = validateWorkItemProjection(input.workItem);
	const evidenceLane = validateObjectArray<WorkItemEvidenceRecorded>(input.evidence, "evidence");
	const outcomesLane = validateObjectArray<EffectRunResult>(input.outcomes, "outcomes");
	const contextLane = validateObjectArray<AgenticWorkItemMemoryContextFact>(
		input.context,
		"context",
	);
	const candidateLane = validateObjectArray<AgenticWorkItemMemoryRecordCandidate<TRecord>>(
		input.candidates,
		"candidates",
	);
	const scoreRulesRaw = recordValue(input.policy, "scoreRules");
	const recordRulesRaw = recordValue(input.policy, "recordRules");
	const scoreRules = Array.isArray(scoreRulesRaw)
		? (scoreRulesRaw as readonly AgenticWorkItemMemoryScoreMappingRule[])
		: [];
	const recordRules = Array.isArray(recordRulesRaw)
		? (recordRulesRaw as readonly AgenticWorkItemMemoryRecordMappingRule<TRecord>[])
		: [];
	issues.push(
		...policyIssues,
		...workItemIssues,
		...evidenceLane.issues,
		...outcomesLane.issues,
		...contextLane.issues,
		...candidateLane.issues,
	);
	const inputs: BridgeInputs<TInput> = {
		workItem: input.workItem,
		evidence: evidenceLane.items,
		outcomes: outcomesLane.items,
		context: contextLane.items,
	};
	const invalidPolicies = policyIssues.length > 0 ? 1 : 0;
	let invalidCandidates = candidateLane.invalidEntries;
	if (policyIssues.length === 0 && workItemIssues.length === 0) {
		for (const rule of scoreRules) {
			const mapped = mapScoreRule(rule, input.policy, inputs);
			issues.push(...mapped.issues);
			if (mapped.signal !== undefined) {
				scoreSignals.push(mapped.signal);
				audit.push(
					auditEntry("score-signal-emitted", input.policy.policyId, input.workItem.workItemId, {
						scoreSignalId: mapped.signal.signalId,
						sourceRefs: refsFromScoreRefs(mapped.signal.sourceRefs),
						policyRefs: refsFromScoreRefs(mapped.signal.policyRefs),
					}),
				);
			}
		}
		for (const rule of recordRules) {
			const mapped = mapRecordRule(rule, input.policy, inputs);
			issues.push(...mapped.issues);
			if (mapped.draft !== undefined) candidates.push(mapped.draft);
			else invalidCandidates += mapped.invalidCandidate;
		}
		for (const candidate of candidateLane.items) {
			const mapped = mapExplicitCandidate(candidate, input.policy, inputs);
			issues.push(...mapped.issues);
			if (mapped.draft !== undefined) candidates.push(mapped.draft);
			else invalidCandidates += mapped.invalidCandidate;
		}
	}
	const resolved = resolveCandidates(candidates, audit, issues);
	const cursor = Object.freeze({
		evaluation: input.evaluation ?? 0,
		workItems: workItemIssues.length > 0 ? 0 : 1,
		scoreRules: scoreRules.length,
		recordRules: recordRules.length,
		explicitCandidates: candidateLane.items.length,
		scoreSignals: scoreSignals.length,
		proposals: resolved.proposals.length,
		duplicateSuppressions: resolved.duplicateSuppressions,
		candidateConflicts: resolved.candidateConflicts,
		invalidPolicies,
		invalidCandidates,
		issues: issues.length,
	});
	const status: AgenticWorkItemMemoryBridgeStatus = Object.freeze({
		kind: "agentic-work-item-memory-bridge-status",
		state: bridgeStatus(cursor),
		cursor,
		...(issues.length === 0
			? {}
			: { issueCodes: Object.freeze([...new Set(issues.map((issue) => issue.code))].sort()) }),
	});
	return Object.freeze({
		kind: "agentic-work-item-memory-bridge-result",
		scoreSignals: Object.freeze(scoreSignals),
		proposals: Object.freeze(resolved.proposals),
		status,
		issues: Object.freeze(issues),
		audit: Object.freeze(audit),
		cursor,
	});
}

function mapScoreRule<TInput>(
	rule: AgenticWorkItemMemoryScoreMappingRule,
	policy: AgenticWorkItemMemoryMappingPolicy,
	inputs: BridgeInputs<TInput>,
): { readonly signal?: ScoreSignal; readonly issues: readonly DataIssue[] } {
	const issues: DataIssue[] = [];
	if (!isNonEmptyString(rule.ruleId)) {
		issues.push(issue("missing-rule-id", "Score mapping rule requires ruleId"));
	}
	if (!isNonEmptyString(rule.dimension)) {
		issues.push(
			issue("missing-score-dimension", "Score mapping rule requires dimension", rule.ruleId),
		);
	}
	issues.push(...refIssues(rule.sourceRefs, "scoreRule.sourceRefs", rule.ruleId));
	issues.push(...refIssues(rule.policyRefs, "scoreRule.policyRefs", rule.ruleId));
	const value = numericMappingValue(rule.value, rule.valueFrom, inputs, "value", issues);
	if (value.value === undefined) return { issues };
	const confidence = numericMappingValue(
		rule.confidence,
		rule.confidenceFrom,
		inputs,
		"confidence",
		issues,
	);
	const weight = numericMappingValue(rule.weight, rule.weightFrom, inputs, "weight", issues);
	const subject = mappedStringValue(rule.subjectId, inputs, issues, "subjectId");
	const subjectId = subject.value ?? inputs.workItem.workItemId;
	if (issues.length > 0) return { issues };
	const selectedSourceRefs = uniqueRefs([
		...value.sourceRefs,
		...confidence.sourceRefs,
		...weight.sourceRefs,
		...subject.sourceRefs,
	]);
	const selectedPolicyRefs = uniqueRefs([
		...value.policyRefs,
		...confidence.policyRefs,
		...weight.policyRefs,
		...subject.policyRefs,
	]);
	const sourceCoordinate = sourceCoordinateKey([
		...workItemSourceRefs(inputs.workItem),
		...selectedSourceRefs,
		...snapshotAgenticMemoryFactRefs(rule.sourceRefs),
		...snapshotAgenticMemoryFactRefs(policy.sourceRefs),
	]);
	const sourceRefs = uniqueRefs([
		...workItemSourceRefs(inputs.workItem),
		...selectedSourceRefs,
		...snapshotAgenticMemoryFactRefs(rule.sourceRefs),
		...snapshotAgenticMemoryFactRefs(policy.sourceRefs),
	]);
	const policyRefs = uniqueRefs([
		{ kind: "agentic-work-item-memory-policy", id: policy.policyId },
		...selectedPolicyRefs,
		...snapshotAgenticMemoryFactRefs(policy.policyRefs),
		...snapshotAgenticMemoryFactRefs(rule.policyRefs),
	]);
	return {
		issues,
		signal: Object.freeze({
			kind: "score-signal",
			signalId: compoundTupleKey("agentic-work-item-memory-score-signal", [
				policy.policyId,
				inputs.workItem.workItemId,
				sourceCoordinate,
				rule.ruleId,
				subjectId,
				rule.dimension,
			]),
			subjectId,
			dimension: rule.dimension,
			value: value.value,
			...(confidence.value === undefined ? {} : { confidence: confidence.value }),
			...(weight.value === undefined ? {} : { weight: weight.value }),
			...(rule.validFromMs === undefined ? {} : { validFromMs: rule.validFromMs }),
			...(rule.validToMs === undefined ? {} : { validToMs: rule.validToMs }),
			sourceRefs: toScoreRefs(sourceRefs),
			policyRefs: toScoreRefs(policyRefs),
			...(rule.metadata === undefined ? {} : { metadata: cloneStrictJsonObject(rule.metadata) }),
		}),
	};
}

function mapRecordRule<TInput, TRecord>(
	rule: AgenticWorkItemMemoryRecordMappingRule<TRecord>,
	policy: AgenticWorkItemMemoryMappingPolicy<TRecord>,
	inputs: BridgeInputs<TInput>,
): {
	readonly draft?: CandidateDraft<TRecord>;
	readonly issues: readonly DataIssue[];
	readonly invalidCandidate: number;
} {
	const issues: DataIssue[] = [];
	if (!isNonEmptyString(rule.ruleId)) {
		issues.push(issue("missing-rule-id", "Record mapping rule requires ruleId"));
	}
	const candidateId = rule.candidateId ?? rule.ruleId;
	if (!isNonEmptyString(candidateId)) {
		issues.push(
			issue("missing-candidate-id", "Record mapping rule requires candidateId or ruleId"),
		);
	}
	issues.push(...refIssues(rule.sourceRefs, "recordRule.sourceRefs", candidateId));
	issues.push(...refIssues(rule.policyRefs, "recordRule.policyRefs", candidateId));
	issues.push(...refIssues(rule.evidenceRefs, "recordRule.evidenceRefs", candidateId));
	const material = materialFromRule(rule, inputs, issues);
	if (issues.length > 0 || material.material === undefined || !isNonEmptyString(candidateId)) {
		return { issues, invalidCandidate: 1 };
	}
	const sourceRefs = uniqueRefs([
		...workItemSourceRefs(inputs.workItem),
		...material.sourceRefs,
		...snapshotAgenticMemoryFactRefs(policy.sourceRefs),
		...snapshotAgenticMemoryFactRefs(rule.sourceRefs),
		...snapshotAgenticMemoryFactRefs(material.material.sourceRefs),
	]);
	const policyRefs = uniqueRefs([
		{ kind: "agentic-work-item-memory-policy", id: policy.policyId },
		...material.policyRefs,
		...snapshotAgenticMemoryFactRefs(policy.policyRefs),
		...snapshotAgenticMemoryFactRefs(rule.policyRefs),
		...snapshotAgenticMemoryFactRefs(material.material.policyRefs),
	]);
	const coordinateSourceRefs = uniqueRefs([
		...workItemSourceRefs(inputs.workItem),
		...material.sourceRefs,
		...snapshotAgenticMemoryFactRefs(rule.sourceRefs),
		...snapshotAgenticMemoryFactRefs(material.material.sourceRefs),
		...snapshotAgenticMemoryFactRefs(material.material.evidenceRefs),
	]);
	return draftFromMaterial(
		"generated",
		candidateId,
		policy,
		inputs.workItem.workItemId,
		material.material,
		{
			reason: rule.reason,
			proposalStatus: rule.proposalStatus,
			coordinateSourceRefs,
			sourceRefs,
			policyRefs,
			evidenceRefs: snapshotAgenticMemoryFactRefs(rule.evidenceRefs),
			metadata: rule.metadata,
		},
	);
}

function mapExplicitCandidate<TInput, TRecord>(
	candidate: AgenticWorkItemMemoryRecordCandidate<TRecord>,
	policy: AgenticWorkItemMemoryMappingPolicy<TRecord>,
	inputs: BridgeInputs<TInput>,
): {
	readonly draft?: CandidateDraft<TRecord>;
	readonly issues: readonly DataIssue[];
	readonly invalidCandidate: number;
} {
	const issues: DataIssue[] = [];
	if (candidate.kind !== "agentic-work-item-memory-record-candidate") {
		issues.push(
			issue("invalid-candidate-kind", "Explicit candidate kind is invalid", candidate.candidateId),
		);
	}
	if (!isNonEmptyString(candidate.candidateId)) {
		issues.push(issue("missing-candidate-id", "Explicit candidate requires candidateId"));
	}
	if (!isNonEmptyString(candidate.workItemId)) {
		issues.push(issue("missing-work-item-id", "Explicit candidate requires workItemId"));
	} else if (candidate.workItemId !== inputs.workItem.workItemId) {
		issues.push(
			issue(
				"candidate-work-item-mismatch",
				"Explicit candidate workItemId does not match current WorkItem",
				candidate.candidateId,
			),
		);
	}
	const material = (candidate as Partial<AgenticWorkItemMemoryRecordCandidate<TRecord>>)
		.candidateMaterial;
	if (material === undefined) {
		issues.push(
			issue(
				"candidate-material-missing",
				"Explicit candidate requires candidateMaterial",
				candidate.candidateId,
			),
		);
	}
	issues.push(...refIssues(candidate.sourceRefs, "candidate.sourceRefs", candidate.candidateId));
	issues.push(...refIssues(candidate.policyRefs, "candidate.policyRefs", candidate.candidateId));
	if (issues.length > 0) return { issues, invalidCandidate: 1 };
	const sourceRefs = uniqueRefs([
		...workItemSourceRefs(inputs.workItem),
		{ kind: "agentic-work-item-memory-candidate", id: candidate.candidateId },
		...snapshotAgenticMemoryFactRefs(policy.sourceRefs),
		...snapshotAgenticMemoryFactRefs(candidate.sourceRefs),
		...snapshotAgenticMemoryFactRefs(material?.sourceRefs),
	]);
	const policyRefs = uniqueRefs([
		{ kind: "agentic-work-item-memory-policy", id: policy.policyId },
		...snapshotAgenticMemoryFactRefs(policy.policyRefs),
		...snapshotAgenticMemoryFactRefs(candidate.policyRefs),
		...snapshotAgenticMemoryFactRefs(material?.policyRefs),
	]);
	const coordinateSourceRefs = uniqueRefs([
		...workItemSourceRefs(inputs.workItem),
		...snapshotAgenticMemoryFactRefs(candidate.sourceRefs),
		...snapshotAgenticMemoryFactRefs(material?.sourceRefs),
		...snapshotAgenticMemoryFactRefs(material?.evidenceRefs),
	]);
	return draftFromMaterial(
		"explicit",
		candidate.candidateId,
		policy,
		candidate.workItemId,
		material as AgenticMemoryRecordCandidateMaterial<TRecord>,
		{
			coordinateSourceRefs,
			sourceRefs,
			policyRefs,
			metadata: candidate.metadata,
		},
	);
}

function draftFromMaterial<T>(
	origin: CandidateOrigin,
	candidateId: string,
	policy: AgenticWorkItemMemoryMappingPolicy<T>,
	workItemId: string,
	material: AgenticMemoryRecordCandidateMaterial<T>,
	extra: {
		readonly reason?: string;
		readonly proposalStatus?: string;
		readonly coordinateSourceRefs: readonly AgenticMemoryFactRef[];
		readonly sourceRefs: readonly AgenticMemoryFactRef[];
		readonly policyRefs: readonly AgenticMemoryFactRef[];
		readonly evidenceRefs?: readonly AgenticMemoryFactRef[];
		readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
	},
): {
	readonly draft?: CandidateDraft<T>;
	readonly issues: readonly DataIssue[];
	readonly invalidCandidate: number;
} {
	const issues = [...validateCandidateMaterial(material, candidateId)];
	if (issues.length > 0) return { issues, invalidCandidate: 1 };
	const operation = material.operation ?? "create";
	const targetRecordId = material.targetRecordId ?? "";
	const sourceCoordinate = sourceCoordinateKey(extra.coordinateSourceRefs);
	const coordinate = canonicalTupleKey([
		policy.policyId,
		workItemId,
		sourceCoordinate,
		candidateId,
		operation,
		targetRecordId,
		material.record.id,
	]);
	const materialIdentity = materialIdentityForCandidate(material, issues);
	if (materialIdentity === undefined) return { issues, invalidCandidate: 1 };
	const proposalId = compoundTupleKey("agentic-work-item-memory-proposal", [coordinate]);
	const idempotencyKey = canonicalTupleKey([
		"agentic-work-item-memory",
		policy.policyId,
		workItemId,
		sourceCoordinate,
		candidateId,
		operation,
		targetRecordId,
		material.record.id,
	]);
	const sourceRefs = uniqueRefs([
		...extra.sourceRefs,
		...snapshotAgenticMemoryFactRefs(material.sourceRefs),
	]);
	const policyRefs = uniqueRefs([
		...extra.policyRefs,
		...snapshotAgenticMemoryFactRefs(material.policyRefs),
	]);
	const evidenceRefs = uniqueRefs([
		...(extra.evidenceRefs ?? []),
		...snapshotAgenticMemoryFactRefs(material.evidenceRefs),
	]);
	return {
		issues,
		invalidCandidate: 0,
		draft: Object.freeze({
			origin,
			candidateId,
			workItemId,
			coordinate,
			materialIdentity,
			coordinateSourceRefs: extra.coordinateSourceRefs,
			sourceRefs,
			policyRefs,
			evidenceRefs,
			proposal: Object.freeze({
				kind: "agentic-memory-record-proposal",
				proposalId,
				operation,
				operationVersion: material.operationVersion ?? 1,
				candidateMaterial: material,
				...(material.targetRecordId === undefined
					? {}
					: { targetRecordId: material.targetRecordId }),
				...(extra.reason === undefined ? {} : { reason: extra.reason }),
				...(extra.proposalStatus === undefined ? {} : { proposalStatus: extra.proposalStatus }),
				sourceRefs,
				policyRefs,
				...(evidenceRefs.length === 0 ? {} : { evidenceRefs }),
				idempotencyKey,
				correlationId: compoundTupleKey("agentic-work-item-memory-correlation", [
					policy.policyId,
					workItemId,
					sourceCoordinate,
				]),
				causationId: compoundTupleKey("agentic-work-item-memory-causation", [
					policy.policyId,
					workItemId,
					sourceCoordinate,
					candidateId,
				]),
				...(extra.metadata === undefined
					? {}
					: { metadata: cloneStrictJsonObject(extra.metadata) }),
			}),
		}),
	};
}

function resolveCandidates<T>(
	candidates: readonly CandidateDraft<T>[],
	audit: AgenticWorkItemMemoryBridgeAuditEntry[],
	issues: DataIssue[],
): {
	readonly proposals: readonly AgenticMemoryRecordProposal<T>[];
	readonly duplicateSuppressions: number;
	readonly candidateConflicts: number;
} {
	const byCoordinate = new Map<string, CandidateDraft<T>[]>();
	for (const candidate of candidates) {
		const bucket = byCoordinate.get(candidate.coordinate);
		if (bucket === undefined) byCoordinate.set(candidate.coordinate, [candidate]);
		else bucket.push(candidate);
	}
	const proposals: AgenticMemoryRecordProposal<T>[] = [];
	let duplicateSuppressions = 0;
	let candidateConflicts = 0;
	for (const [coordinate, bucket] of byCoordinate) {
		const identities = new Set(bucket.map((candidate) => candidate.materialIdentity));
		if (identities.size > 1) {
			candidateConflicts += 1;
			const first = bucket[0];
			issues.push(
				issue(
					"candidate-conflict",
					"Explicit and generated candidates share a bridge coordinate with different material",
					first?.candidateId,
					{ refs: bucket.map((candidate) => candidate.proposal.proposalId) },
				),
			);
			audit.push(
				auditEntry("candidate-conflict", "candidate-conflict", first?.workItemId, {
					candidateId: first?.candidateId,
					coordinate,
					reason: "same coordinate with different material",
					sourceRefs: first?.sourceRefs,
					policyRefs: first?.policyRefs,
				}),
			);
			continue;
		}
		const kept = bucket[0];
		if (kept === undefined) continue;
		const mergedProposal = proposalWithMergedRefs(kept.proposal, bucket);
		proposals.push(mergedProposal);
		audit.push(
			auditEntry("record-proposal-emitted", "record-proposal", kept.workItemId, {
				candidateId: kept.candidateId,
				proposalId: mergedProposal.proposalId,
				coordinate,
				sourceRefs: uniqueRefs(bucket.flatMap((candidate) => candidate.sourceRefs)),
				policyRefs: uniqueRefs(bucket.flatMap((candidate) => candidate.policyRefs)),
			}),
		);
		if (bucket.length > 1) {
			duplicateSuppressions += bucket.length - 1;
			audit.push(
				auditEntry("duplicate-suppressed", "duplicate-suppressed", kept.workItemId, {
					candidateId: kept.candidateId,
					proposalId: mergedProposal.proposalId,
					coordinate,
					reason: "same coordinate and same candidate material",
					sourceRefs: uniqueRefs(bucket.flatMap((candidate) => candidate.sourceRefs)),
					policyRefs: uniqueRefs(bucket.flatMap((candidate) => candidate.policyRefs)),
					metadata: {
						suppressedCandidateIds: bucket.slice(1).map((candidate) => candidate.candidateId),
					},
				}),
			);
		}
	}
	return { proposals: Object.freeze(proposals), duplicateSuppressions, candidateConflicts };
}

function proposalWithMergedRefs<T>(
	proposal: AgenticMemoryRecordProposal<T>,
	bucket: readonly CandidateDraft<T>[],
): AgenticMemoryRecordProposal<T> {
	const sourceRefs = uniqueRefs(bucket.flatMap((candidate) => candidate.sourceRefs));
	const policyRefs = uniqueRefs(bucket.flatMap((candidate) => candidate.policyRefs));
	const evidenceRefs = uniqueRefs(bucket.flatMap((candidate) => candidate.evidenceRefs));
	return Object.freeze({
		...proposal,
		sourceRefs,
		policyRefs,
		...(evidenceRefs.length === 0 ? {} : { evidenceRefs }),
	});
}

function materialFromRule<TInput, TRecord>(
	rule: AgenticWorkItemMemoryRecordMappingRule<TRecord>,
	inputs: BridgeInputs<TInput>,
	issues: DataIssue[],
): MaterialSelection<TRecord> {
	if (rule.candidateMaterial !== undefined) {
		return {
			material: rule.candidateMaterial,
			sourceRefs: Object.freeze([]),
			policyRefs: Object.freeze([]),
		};
	}
	if (rule.candidateMaterialFrom !== undefined) {
		const selected = selectValue(
			rule.candidateMaterialFrom,
			inputs,
			issues,
			"candidateMaterialFrom",
		);
		if (selected.value === undefined) {
			issues.push(
				issue("candidate-material-missing", "candidateMaterialFrom did not resolve", rule.ruleId),
			);
			return {
				sourceRefs: selected.sourceRefs,
				policyRefs: selected.policyRefs,
			};
		}
		return {
			material: selected.value as AgenticMemoryRecordCandidateMaterial<TRecord>,
			sourceRefs: selected.sourceRefs,
			policyRefs: selected.policyRefs,
		};
	}
	if (rule.record !== undefined) {
		const operation = rule.operation ?? "create";
		const targetRecordId = mappedStringValue(rule.targetRecordId, inputs, issues, "targetRecordId");
		return {
			material: {
				kind: "agentic-memory-record-candidate-material",
				operation,
				operationVersion: 1,
				record: rule.record,
				...(targetRecordId.value === undefined ? {} : { targetRecordId: targetRecordId.value }),
				sourceRefs: rule.sourceRefs,
				policyRefs: rule.policyRefs,
				evidenceRefs: rule.evidenceRefs,
				metadata: rule.metadata,
			},
			sourceRefs: targetRecordId.sourceRefs,
			policyRefs: targetRecordId.policyRefs,
		};
	}
	issues.push(
		issue(
			"candidate-material-missing",
			"Record mapping rule requires candidate material",
			rule.ruleId,
		),
	);
	return {
		sourceRefs: Object.freeze([]),
		policyRefs: Object.freeze([]),
	};
}

function validatePolicy(policy: unknown): readonly DataIssue[] {
	const issues: DataIssue[] = [];
	let policyIsData = true;
	try {
		strictJsonCodec.encode(policy);
	} catch (error) {
		policyIsData = false;
		issues.push(
			issue("policy-not-data", `Mapping policy must be serializable DATA: ${errorMessage(error)}`),
		);
	}
	const policyKind = recordValue(policy, "kind");
	const policyId = recordValue(policy, "policyId");
	const sourceRefs = recordValue(policy, "sourceRefs");
	const policyRefs = recordValue(policy, "policyRefs");
	const scoreRules = recordValue(policy, "scoreRules");
	const recordRules = recordValue(policy, "recordRules");
	if (policyKind !== "agentic-work-item-memory-mapping-policy") {
		issues.push(issue("invalid-policy-kind", "Mapping policy kind is invalid"));
	}
	if (!isNonEmptyString(policyId)) {
		issues.push(issue("missing-policy-id", "Mapping policy requires policyId"));
	}
	if (isRecord(policy)) {
		issues.push(...forbiddenPolicyKeyIssues(policy));
		issues.push(...refIssues(sourceRefs, "policy.sourceRefs"));
		issues.push(...refIssues(policyRefs, "policy.policyRefs"));
		if (scoreRules !== undefined && !Array.isArray(scoreRules)) {
			issues.push(issue("invalid-score-rules", "Mapping policy scoreRules must be an array"));
		}
		if (recordRules !== undefined && !Array.isArray(recordRules)) {
			issues.push(issue("invalid-record-rules", "Mapping policy recordRules must be an array"));
		}
		if (policyIsData && Array.isArray(scoreRules)) {
			const scoreRules = validateObjectArray<AgenticWorkItemMemoryScoreMappingRule>(
				recordValue(policy, "scoreRules"),
				"policy.scoreRules",
			);
			issues.push(...scoreRules.issues);
			for (let i = 0; i < scoreRules.items.length; i += 1) {
				issues.push(...validateScoreRuleData(scoreRules.items[i]!, i));
			}
		}
		if (policyIsData && Array.isArray(recordRules)) {
			const recordRules = validateObjectArray<AgenticWorkItemMemoryRecordMappingRule>(
				recordValue(policy, "recordRules"),
				"policy.recordRules",
			);
			issues.push(...recordRules.issues);
			for (let i = 0; i < recordRules.items.length; i += 1) {
				issues.push(...validateRecordRuleData(recordRules.items[i]!, i));
			}
		}
	}
	return Object.freeze(issues);
}

function validateWorkItemProjection(workItem: unknown): readonly DataIssue[] {
	if (!isRecord(workItem)) {
		return Object.freeze([
			issue("invalid-work-item", "WorkItem projection input must be an object"),
		]);
	}
	if (!isNonEmptyString(workItem.workItemId)) {
		return Object.freeze([
			issue("missing-work-item-id", "WorkItem projection requires workItemId"),
		]);
	}
	return Object.freeze([]);
}

function validateObjectArray<T>(
	value: unknown,
	label: string,
): {
	readonly items: readonly T[];
	readonly issues: readonly DataIssue[];
	readonly invalidEntries: number;
} {
	if (value === undefined) {
		return { items: Object.freeze([]), issues: Object.freeze([]), invalidEntries: 0 };
	}
	if (!Array.isArray(value)) {
		return {
			items: Object.freeze([]),
			issues: Object.freeze([issue("invalid-input-array", `${label} must be an array`, label)]),
			invalidEntries: 1,
		};
	}
	const items: T[] = [];
	const issues: DataIssue[] = [];
	for (let i = 0; i < value.length; i += 1) {
		if (!Object.hasOwn(value, i)) {
			issues.push(issue("invalid-input-array", `${label}[${i}] must be present`, label));
			continue;
		}
		const entry = value[i];
		if (!isRecord(entry)) {
			issues.push(issue("invalid-input-entry", `${label}[${i}] must be an object`, label));
			continue;
		}
		items.push(entry as T);
	}
	return {
		items: Object.freeze(items),
		issues: Object.freeze(issues),
		invalidEntries: issues.length,
	};
}

function validateScoreRuleData(
	rule: AgenticWorkItemMemoryScoreMappingRule,
	index: number,
): readonly DataIssue[] {
	const issues: DataIssue[] = [];
	if (!isRecord(rule)) return [issue("invalid-score-rule", "Score mapping rule must be an object")];
	issues.push(...selectorIssues(rule.valueFrom, `policy.scoreRules[${index}].valueFrom`));
	issues.push(...selectorIssues(rule.confidenceFrom, `policy.scoreRules[${index}].confidenceFrom`));
	issues.push(...selectorIssues(rule.weightFrom, `policy.scoreRules[${index}].weightFrom`));
	if (isRecord(rule.subjectId)) {
		issues.push(...selectorIssues(rule.subjectId, `policy.scoreRules[${index}].subjectId`));
	}
	issues.push(...refIssues(rule.sourceRefs, `policy.scoreRules[${index}].sourceRefs`));
	issues.push(...refIssues(rule.policyRefs, `policy.scoreRules[${index}].policyRefs`));
	return Object.freeze(issues);
}

function validateRecordRuleData(
	rule: AgenticWorkItemMemoryRecordMappingRule,
	index: number,
): readonly DataIssue[] {
	const issues: DataIssue[] = [];
	if (!isRecord(rule))
		return [issue("invalid-record-rule", "Record mapping rule must be an object")];
	issues.push(
		...selectorIssues(
			rule.candidateMaterialFrom,
			`policy.recordRules[${index}].candidateMaterialFrom`,
		),
	);
	if (isRecord(rule.targetRecordId)) {
		issues.push(
			...selectorIssues(rule.targetRecordId, `policy.recordRules[${index}].targetRecordId`),
		);
	}
	issues.push(...refIssues(rule.sourceRefs, `policy.recordRules[${index}].sourceRefs`));
	issues.push(...refIssues(rule.policyRefs, `policy.recordRules[${index}].policyRefs`));
	issues.push(...refIssues(rule.evidenceRefs, `policy.recordRules[${index}].evidenceRefs`));
	return Object.freeze(issues);
}

function selectorIssues(value: unknown, label: string): readonly DataIssue[] {
	if (value === undefined) return [];
	if (!isRecord(value)) return [issue("invalid-selector", `${label} must be an object`, label)];
	if (!["workItem", "evidence", "outcome", "context"].includes(String(value.input))) {
		return [issue("invalid-selector", `${label}.input is invalid`, label)];
	}
	if (!Array.isArray(value.path)) {
		return [issue("invalid-selector", `${label}.path must be an array`, label)];
	}
	const errors: DataIssue[] = [];
	for (let i = 0; i < value.path.length; i += 1) {
		if (!Object.hasOwn(value.path, i)) {
			errors.push(issue("invalid-selector", `${label}.path[${i}] must be present`, label));
			continue;
		}
		const segment = value.path[i];
		if (typeof segment !== "string" && typeof segment !== "number") {
			errors.push(issue("invalid-selector", `${label}.path[${i}] must be string or number`, label));
		}
	}
	if (value.refId !== undefined && !isNonEmptyString(value.refId)) {
		errors.push(issue("invalid-selector", `${label}.refId must be non-empty when present`, label));
	}
	return Object.freeze(errors);
}

function forbiddenPolicyKeyIssues(
	value: unknown,
	path = "policy",
	seen = new Set<object>(),
	depth = 0,
): readonly DataIssue[] {
	if (value === null || typeof value !== "object") return [];
	if (depth > 64) {
		return Object.freeze([
			issue("policy-too-deep", `Mapping policy nested data is too deep at ${path}`, path),
		]);
	}
	if (seen.has(value)) {
		return Object.freeze([
			issue("policy-not-data", `Mapping policy contains circular data at ${path}`, path),
		]);
	}
	seen.add(value);
	if (Array.isArray(value)) {
		const found = value.flatMap((entry, index) =>
			forbiddenPolicyKeyIssues(entry, `${path}[${index}]`, seen, depth + 1),
		);
		seen.delete(value);
		return Object.freeze(found);
	}
	const issues: DataIssue[] = [];
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const key of Object.keys(descriptors)) {
		if (FORBIDDEN_POLICY_KEYS.has(key)) {
			issues.push(
				issue(
					"policy-forbidden-authority",
					`Mapping policy contains forbidden field ${path}.${key}`,
					path,
				),
			);
		}
		const descriptor = descriptors[key];
		if (descriptor === undefined || !("value" in descriptor)) {
			issues.push(
				issue("policy-not-data", `Mapping policy contains accessor data at ${path}.${key}`, path),
			);
			continue;
		}
		const next = descriptor.value;
		issues.push(...forbiddenPolicyKeyIssues(next, `${path}.${key}`, seen, depth + 1));
	}
	seen.delete(value);
	return Object.freeze(issues);
}

function validateCandidateMaterial(
	material: AgenticMemoryRecordCandidateMaterial,
	candidateId: string,
): readonly DataIssue[] {
	const issues: DataIssue[] = [];
	if (!isRecord(material) || material.kind !== "agentic-memory-record-candidate-material") {
		issues.push(
			issue("invalid-candidate-material-kind", "Candidate material kind is invalid", candidateId),
		);
		return Object.freeze(issues);
	}
	if (material.operation !== undefined && !isOperation(material.operation)) {
		issues.push(
			issue(
				"invalid-candidate-operation",
				"Candidate operation must be create/update/replace",
				candidateId,
			),
		);
	}
	if (material.operationVersion !== undefined && material.operationVersion !== 1) {
		issues.push(
			issue("invalid-operation-version", "Candidate operationVersion must be 1", candidateId),
		);
	}
	if (material.targetRecordId !== undefined && !isNonEmptyString(material.targetRecordId)) {
		issues.push(
			issue("invalid-target-record-id", "Candidate targetRecordId must be non-empty", candidateId),
		);
	}
	if (
		!isRecord(material.record) ||
		!isNonEmptyString((material.record as Partial<AgenticMemoryRecord>).id)
	) {
		issues.push(
			issue("invalid-candidate-record", "Candidate record.id must be non-empty", candidateId),
		);
	}
	if (
		!isRecord(material.record) ||
		!isRecord((material.record as Partial<AgenticMemoryRecord>).fragment) ||
		!isNonEmptyString((material.record as Partial<AgenticMemoryRecord>).fragment?.id)
	) {
		issues.push(
			issue(
				"invalid-candidate-fragment",
				"Candidate record.fragment.id must be non-empty",
				candidateId,
			),
		);
	}
	for (const field of ["sourceRefs", "policyRefs", "evidenceRefs"] as const) {
		issues.push(...refIssues(material[field], `candidateMaterial.${field}`, candidateId));
	}
	return Object.freeze(issues);
}

function materialIdentityForCandidate(
	material: AgenticMemoryRecordCandidateMaterial,
	issues: DataIssue[],
): string | undefined {
	try {
		return stableJsonString({
			operation: material.operation ?? "create",
			operationVersion: material.operationVersion ?? 1,
			targetRecordId: material.targetRecordId ?? null,
			record: agenticMemoryRecordFrame(material.record as AgenticMemoryRecord<StrictJsonValue>),
		});
	} catch (error) {
		issues.push(
			issue(
				"candidate-material-identity-failed",
				`Candidate material identity could not be derived: ${errorMessage(error)}`,
				material.record?.id,
			),
		);
		return undefined;
	}
}

function numericMappingValue<TInput>(
	constant: number | undefined,
	selector: AgenticWorkItemMemoryDataSelector | undefined,
	inputs: BridgeInputs<TInput>,
	label: string,
	issues: DataIssue[],
): {
	readonly value?: number;
	readonly sourceRefs: readonly AgenticMemoryFactRef[];
	readonly policyRefs: readonly AgenticMemoryFactRef[];
} {
	const selected =
		selector === undefined
			? ({
					value: constant,
					sourceRefs: Object.freeze([]),
					policyRefs: Object.freeze([]),
				} satisfies SelectedValue)
			: selectValue(selector, inputs, issues, label);
	const value = selected.value;
	if (value === undefined) {
		return { sourceRefs: selected.sourceRefs, policyRefs: selected.policyRefs };
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		issues.push(issue("invalid-score-value", `Score ${label} must resolve to a finite number`));
		return { sourceRefs: selected.sourceRefs, policyRefs: selected.policyRefs };
	}
	return { value, sourceRefs: selected.sourceRefs, policyRefs: selected.policyRefs };
}

function mappedStringValue<TInput>(
	value: string | AgenticWorkItemMemoryDataSelector | undefined,
	inputs: BridgeInputs<TInput>,
	issues: DataIssue[],
	label: string,
): {
	readonly value?: string;
	readonly sourceRefs: readonly AgenticMemoryFactRef[];
	readonly policyRefs: readonly AgenticMemoryFactRef[];
} {
	if (typeof value === "string") {
		return { value, sourceRefs: Object.freeze([]), policyRefs: Object.freeze([]) };
	}
	if (value === undefined) {
		return { sourceRefs: Object.freeze([]), policyRefs: Object.freeze([]) };
	}
	const selected = selectValue(value, inputs, issues, label);
	return typeof selected.value === "string" && selected.value.length > 0
		? { value: selected.value, sourceRefs: selected.sourceRefs, policyRefs: selected.policyRefs }
		: { sourceRefs: selected.sourceRefs, policyRefs: selected.policyRefs };
}

function selectValue<TInput>(
	selector: AgenticWorkItemMemoryDataSelector,
	inputs: BridgeInputs<TInput>,
	issues: DataIssue[],
	label: string,
): SelectedValue {
	const source = selectSource(selector, inputs, issues, label);
	if (source === undefined) {
		return {
			sourceRefs: Object.freeze([]),
			policyRefs: Object.freeze([]),
		};
	}
	let current: unknown = source.value;
	for (const segment of selector.path) {
		if (current === null || typeof current !== "object") {
			return {
				value: selector.fallback,
				sourceRefs: source.sourceRefs,
				policyRefs: source.policyRefs,
			};
		}
		current = (current as Record<string | number, unknown>)[segment];
	}
	return {
		value: current === undefined ? selector.fallback : current,
		sourceRefs: source.sourceRefs,
		policyRefs: source.policyRefs,
	};
}

function selectSource<TInput>(
	selector: AgenticWorkItemMemoryDataSelector,
	inputs: BridgeInputs<TInput>,
	issues: DataIssue[],
	label: string,
): SelectedValue | undefined {
	if (selector.input === "workItem") {
		return {
			value: inputs.workItem,
			sourceRefs: workItemSourceRefs(inputs.workItem),
			policyRefs: Object.freeze([]),
		};
	}
	if (selector.input === "evidence") {
		const found = byRef(
			inputs.evidence,
			selector.refId,
			(entry) => entry.evidenceId,
			(entry) => entry.workItemId,
			inputs.workItem.workItemId,
			issues,
			label,
		);
		return found === undefined
			? undefined
			: { value: found, sourceRefs: evidenceSourceRefs(found), policyRefs: Object.freeze([]) };
	}
	if (selector.input === "outcome") {
		const found = byRef(
			inputs.outcomes,
			selector.refId,
			(entry) => entry.resultId,
			(entry) => subjectWorkItemId(entry.subjectRefs),
			inputs.workItem.workItemId,
			issues,
			label,
		);
		return found === undefined
			? undefined
			: { value: found, sourceRefs: outcomeSourceRefs(found), policyRefs: Object.freeze([]) };
	}
	const found = byRef(
		inputs.context,
		selector.refId,
		(entry) => entry.contextId,
		(entry) => entry.workItemId,
		inputs.workItem.workItemId,
		issues,
		label,
	);
	return found === undefined
		? undefined
		: {
				value: found,
				sourceRefs: contextSourceRefs(found),
				policyRefs: refsFromSourceRefs(found.policyRefs ?? []),
			};
}

function byRef<T>(
	values: readonly T[],
	refId: string | undefined,
	id: (value: T) => string | undefined,
	workItemId: (value: T) => string | undefined,
	currentWorkItemId: string,
	issues: DataIssue[],
	label: string,
): T | undefined {
	if (refId !== undefined) {
		const found = values.find((value) => id(value) === refId);
		if (found === undefined) {
			issues.push(
				issue("selector-source-missing", `${label} source '${refId}' was not found`, refId),
			);
			return undefined;
		}
		if (workItemId(found) !== currentWorkItemId) {
			issues.push(
				issue(
					"selector-source-mismatch",
					`${label} source '${refId}' does not belong to current WorkItem`,
					refId,
				),
			);
			return undefined;
		}
		return found;
	}
	const found = values.find((value) => workItemId(value) === currentWorkItemId);
	if (found === undefined) {
		issues.push(
			issue(
				"selector-source-missing",
				`${label} has no source for current WorkItem '${currentWorkItemId}'`,
				currentWorkItemId,
			),
		);
	}
	return found;
}

function subjectWorkItemId(refs: readonly SourceRef[] | undefined): string | undefined {
	return refs?.find((ref) => ref.kind === "work-item")?.id;
}

function bridgeStatus(cursor: {
	readonly scoreSignals: number;
	readonly proposals: number;
	readonly candidateConflicts: number;
	readonly invalidPolicies: number;
	readonly invalidCandidates: number;
	readonly issues: number;
}): AgenticWorkItemMemoryBridgeStatusState {
	if (cursor.candidateConflicts > 0) return "candidate-conflict";
	if (cursor.invalidPolicies > 0) return "blocked";
	if (cursor.issues > 0 || cursor.invalidCandidates > 0) return "partial";
	if (cursor.scoreSignals === 0 && cursor.proposals === 0) return "empty";
	return "ready";
}

function workItemSourceRefs<T>(workItem: WorkItemProjection<T>): readonly AgenticMemoryFactRef[] {
	return uniqueRefs([
		{
			kind: "work-item",
			id: workItem.workItemId,
			metadata: {
				authoringRevision: workItem.authoringRevision,
				executionInputRevision: workItem.executionInputRevision,
			},
		},
		...refsFromSourceRefs(workItem.sourceRefs ?? []),
		...refsFromSourceRefs(workItem.revisionSourceRefs ?? []),
	]);
}

function evidenceSourceRefs(evidence: WorkItemEvidenceRecorded): readonly AgenticMemoryFactRef[] {
	return uniqueRefs([
		{ kind: "work-item-evidence", id: evidence.evidenceId },
		{ kind: "effect-run", id: evidence.effectRunId },
		{ kind: "effect-run-result", id: evidence.effectRunResultId },
		...refsFromSourceRefs(evidence.sourceRefs ?? []),
	]);
}

function outcomeSourceRefs(outcome: EffectRunResult): readonly AgenticMemoryFactRef[] {
	return uniqueRefs([
		{ kind: "effect-run-result", id: outcome.resultId },
		...refsFromSourceRefs(outcome.subjectRefs ?? []),
		...refsFromSourceRefs(outcome.sourceRefs ?? []),
	]);
}

function contextSourceRefs(
	context: AgenticWorkItemMemoryContextFact,
): readonly AgenticMemoryFactRef[] {
	return uniqueRefs([
		{ kind: "agentic-work-item-memory-context", id: context.contextId },
		...refsFromSourceRefs(context.sourceRefs ?? []),
	]);
}

function refsFromSourceRefs(refs: readonly SourceRef[]): readonly AgenticMemoryFactRef[] {
	return refs
		.filter((ref) => isNonEmptyString(ref.kind) && isNonEmptyString(ref.id))
		.map((ref) =>
			Object.freeze({
				kind: ref.kind,
				id: ref.id,
				...(ref.metadata === undefined ? {} : { metadata: safeMetadata(ref.metadata) }),
			}),
		);
}

function toScoreRefs(refs: readonly AgenticMemoryFactRef[]): readonly ScoreRef[] {
	return Object.freeze(
		refs.map((ref) =>
			Object.freeze({
				kind: ref.kind,
				id: ref.id,
				...(ref.metadata === undefined ? {} : { metadata: ref.metadata }),
			}),
		),
	);
}

function refsFromScoreRefs(refs: readonly ScoreRef[] | undefined): readonly AgenticMemoryFactRef[] {
	return (refs ?? []).map((ref) =>
		Object.freeze({
			kind: ref.kind,
			id: ref.id,
			...(ref.metadata === undefined ? {} : { metadata: safeMetadata(ref.metadata) }),
		}),
	);
}

function uniqueRefs(refs: readonly AgenticMemoryFactRef[]): readonly AgenticMemoryFactRef[] {
	const seen = new Set<string>();
	const out: AgenticMemoryFactRef[] = [];
	for (const ref of refs) {
		if (!isNonEmptyString(ref.kind) || !isNonEmptyString(ref.id)) continue;
		const key = canonicalTupleKey([ref.kind, ref.id, stableJsonString(ref.metadata ?? {})]);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(Object.freeze(ref));
	}
	return Object.freeze(out);
}

function sourceCoordinateKey(refs: readonly AgenticMemoryFactRef[]): string {
	return canonicalTupleKey(
		refs
			.map((ref) => canonicalTupleKey([ref.kind, ref.id, stableJsonString(ref.metadata ?? {})]))
			.sort(),
	);
}

function safeMetadata(value: unknown): Readonly<Record<string, StrictJsonValue>> | undefined {
	try {
		return cloneStrictJsonObject(value);
	} catch {
		return undefined;
	}
}

function refIssues(refs: unknown, label: string, subjectId?: string): readonly DataIssue[] {
	if (refs === undefined) return [];
	return validateAgenticMemoryFactRefs(refs).map((message) =>
		issue("invalid-source-coordinate", `${label}: ${message}`, subjectId),
	);
}

function auditEntry(
	action: AgenticWorkItemMemoryBridgeAuditEntry["action"],
	scope: string,
	workItemId: string | undefined,
	opts: Omit<
		AgenticWorkItemMemoryBridgeAuditEntry,
		"kind" | "auditId" | "action" | "workItemId"
	> = {},
): AgenticWorkItemMemoryBridgeAuditEntry {
	return Object.freeze({
		kind: "agentic-work-item-memory-bridge-audit",
		auditId: compoundTupleKey("agentic-work-item-memory-bridge-audit", [
			scope,
			action,
			workItemId ?? "",
			opts.candidateId ?? "",
			opts.proposalId ?? "",
			opts.scoreSignalId ?? "",
			opts.coordinate ?? "",
		]),
		action,
		...(workItemId === undefined ? {} : { workItemId }),
		...opts,
	});
}

function issue(
	code: string,
	message: string,
	subjectId?: string,
	extra: Partial<DataIssue> = {},
): DataIssue {
	return Object.freeze({
		kind: "issue",
		code: `agentic-work-item-memory.${code}`,
		message,
		severity:
			code.includes("conflict") || code.includes("invalid") || code.includes("missing")
				? "error"
				: "warning",
		...(subjectId === undefined ? {} : { subjectId }),
		...extra,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown, key: string): unknown {
	if (!isRecord(value)) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function isOperation(value: unknown): value is AgenticMemoryRecordApplicationOperation {
	return OPERATIONS.includes(value as AgenticMemoryRecordApplicationOperation);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
