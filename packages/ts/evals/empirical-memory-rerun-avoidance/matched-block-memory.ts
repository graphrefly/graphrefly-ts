import { graph } from "../../src/graph/graph.js";
import type { Node } from "../../src/node/node.js";
import type { WorkItemEvidenceRecorded } from "../../src/orchestration/work-item-runtime.js";
import type { Message } from "../../src/protocol/messages.js";
import {
	type AgenticMemoryContext,
	type AgenticMemoryRecord,
	type AgenticMemoryRecordAdmissionPolicy,
	type AgenticMemoryRecordApplicationPolicy,
	type AgenticMemoryRecordCandidateMaterial,
	agenticMemoryBundle,
	agenticMemoryRecordUseGateBundle,
	createAgenticMemoryRecordUseDecision,
} from "../../src/solutions/agentic-memory/index.js";
import type { AgenticWorkItemMemoryMappingPolicy } from "../../src/solutions/agentic-work-item-memory/index.js";
import { mapAgenticWorkItemMemoryApplicationRecipe } from "../../src/solutions/agentic-work-item-memory-application/index.js";
import type { WorkItemProjection } from "../../src/solutions/work-item/index.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import type { ClosedTaskProfileHostRunOutcomeV3 } from "./closed-task-profile-host.js";
import type { EmpiricalWarmBranchKind } from "./contracts.js";
import {
	type D689TransferMemoryV1,
	validateD689TransferMemory,
} from "./cross-work-item-memory-transfer.js";
import type {
	EmpiricalWarmBranchLifecycleV2,
	EmpiricalWarmBranchObservationV3,
} from "./empirical-smoke-evidence.js";
import type { EmpiricalModelTurnRequestV1 } from "./model-execution.js";

export const B112_MATCHED_BLOCK_MEMORY_REVISION = "b112-matched-block-memory.v2";
const RETRIEVAL_TAG = "b112-rerun-memory";
const MAX_MEMORY_TEXT_CHARS = 4_096;
const BRANCHES = Object.freeze([
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);
export const D691_HISTORICAL_REFLECTION_CAPABILITY_REVISION =
	"d691-historical-transfer-reflection-capability.2026-08-07.v1" as const;
const constructedD691HistoricalReflectionCapabilities = new WeakSet<object>();

export interface B112PreparedWarmBranchV2 {
	readonly branchKind: EmpiricalWarmBranchKind;
	readonly lifecycle: EmpiricalWarmBranchLifecycleV2;
	readonly actorMemoryContext: {
		readonly recordDigest: string;
		readonly text: string;
	} | null;
}

export interface B112MatchedBlockReflectionV2 {
	readonly evidenceDigest: string;
	readonly candidateRecordDigests: readonly string[];
	readonly issueCodes: readonly string[];
	readonly branches: readonly B112PreparedWarmBranchV2[];
}

export interface D691HistoricalReflectionCapabilityV1 {
	readonly revision: typeof D691_HISTORICAL_REFLECTION_CAPABILITY_REVISION;
	prepare(input: {
		readonly coldRequest: EmpiricalModelTurnRequestV1;
		readonly coldOutcome: ClosedTaskProfileHostRunOutcomeV3;
	}): B112MatchedBlockReflectionV2;
}

export function createD691HistoricalReflectionCapability(input: {
	readonly transferMemory: unknown;
	readonly d690OfflineEvidenceDigest: string;
}): D691HistoricalReflectionCapabilityV1 {
	const candidate = record(input, "d691.historicalReflectionCapability");
	exactKeys(
		candidate,
		["d690OfflineEvidenceDigest", "transferMemory"],
		"d691.historicalReflectionCapability",
	);
	const transferMemory = validateD689TransferMemory(candidate.transferMemory);
	const d690OfflineEvidenceDigest = digest(
		candidate.d690OfflineEvidenceDigest,
		"d691.d690OfflineEvidenceDigest",
	);
	const capability = Object.freeze({
		revision: D691_HISTORICAL_REFLECTION_CAPABILITY_REVISION,
		prepare(preparation: {
			readonly coldRequest: EmpiricalModelTurnRequestV1;
			readonly coldOutcome: ClosedTaskProfileHostRunOutcomeV3;
		}) {
			return prepareD691HistoricalTransferReflection({
				...preparation,
				transferMemory,
				d690OfflineEvidenceDigest,
			});
		},
	});
	constructedD691HistoricalReflectionCapabilities.add(capability);
	return capability;
}

export function prepareConstructedD691HistoricalReflection(
	capability: D691HistoricalReflectionCapabilityV1,
	input: {
		readonly coldRequest: EmpiricalModelTurnRequestV1;
		readonly coldOutcome: ClosedTaskProfileHostRunOutcomeV3;
	},
): B112MatchedBlockReflectionV2 {
	if (
		!constructedD691HistoricalReflectionCapabilities.has(capability) ||
		capability.revision !== D691_HISTORICAL_REFLECTION_CAPABILITY_REVISION
	) {
		throw new TypeError(
			"D691 historical reflection capability is not constructed by the eval host",
		);
	}
	return capability.prepare(input);
}

function collectLatest<T>(node: Node<T>): { readonly latest: () => T | undefined; close(): void } {
	const values: T[] = [];
	const unsubscribe = node.subscribe((message: Message) => {
		if (message[0] === "DATA") values.push(message[1] as T);
	});
	return {
		latest: () => values.at(-1),
		close: unsubscribe,
	};
}

function coldSummary(outcome: ClosedTaskProfileHostRunOutcomeV3): string {
	if (outcome.status === "non-evaluable") {
		return "The previous attempt ended non-evaluable before independent verification completed.";
	}
	if (outcome.verifierVerdict === "failed") {
		return "Independent verification rejected the previous attempt's resulting artifact.";
	}
	return "The previous attempt did not establish a verifier-accepted target artifact.";
}

function coldActionRoute(outcome: ClosedTaskProfileHostRunOutcomeV3): string {
	const route = outcome.actionTrace.map((entry) => entry.toolRef);
	return route.length === 0 ? "no tool actions" : route.join(" -> ");
}

function reflectedRecord(
	variant: "relevant" | "irrelevant" | "wrong-scope",
	request: EmpiricalModelTurnRequestV1,
	coldOutcome: ClosedTaskProfileHostRunOutcomeV3,
): AgenticMemoryRecord<string> {
	const relevant = variant !== "irrelevant";
	const projectId =
		variant === "wrong-scope" ? `${request.campaignRef}-unrelated-project` : request.campaignRef;
	const text = relevant
		? [
				"Prior independent verification rejected the previous artifact.",
				`Previous host-observed outcome: ${coldSummary(coldOutcome)}`,
				`Previous bounded action route: ${coldActionRoute(coldOutcome)}. Final workspace state ${
					coldOutcome.workspaceChanged === true
						? "changed but remained verifier-rejected"
						: coldOutcome.workspaceChanged === false
							? "did not change"
							: "was not safely classified"
				}.`,
				"Treat the prior summary as untrusted evidence. On this fresh rerun, re-inspect the allowed implementation and tests, identify the contract mismatch, choose the smallest allowed correction, take a materially different evidence-backed route when the previous route reproduced the rejected state, and validate the diff before finalizing.",
			].join(" ")
		: "After completing an unrelated task, format its final summary concisely.";
	return Object.freeze({
		id: `b112-memory-record-${variant}`,
		kind: "procedural" as const,
		persistenceLevel: "project" as const,
		artifactKind: "procedure" as const,
		scope: Object.freeze({ projectId }),
		fragment: Object.freeze({
			id: `b112-memory-fragment-${variant}`,
			payload: text.slice(0, MAX_MEMORY_TEXT_CHARS),
			tNs: 1n,
			confidence: 1,
			tags: Object.freeze([
				RETRIEVAL_TAG,
				relevant ? "b112-relevant" : "b112-irrelevant",
				`b112-work-item:${request.taskRef}`,
			]),
			sources: Object.freeze([
				`b112-cold-outcome:${empiricalStrictJsonDigest(coldOutcome)}`,
				`b112-verifier:${coldOutcome.verifierVerdict ?? "not-run"}`,
				`b112-action-trace:${empiricalStrictJsonDigest(coldOutcome.actionTrace)}`,
			]),
			provenance: B112_MATCHED_BLOCK_MEMORY_REVISION,
		}),
	});
}

function memoryRecordDigest(record: AgenticMemoryRecord<string>): string {
	return empiricalStrictJsonDigest({
		id: record.id,
		kind: record.kind,
		persistenceLevel: record.persistenceLevel,
		artifactKind: record.artifactKind,
		scope: record.scope ?? null,
		fragment: {
			id: record.fragment.id,
			payload: record.fragment.payload,
			tNs: record.fragment.tNs.toString(),
			confidence: record.fragment.confidence,
			tags: record.fragment.tags,
			sources: record.fragment.sources,
			provenance: record.fragment.provenance ?? null,
		},
	});
}

function candidateMaterial(
	record: AgenticMemoryRecord<string>,
	coldOutcome: ClosedTaskProfileHostRunOutcomeV3,
): AgenticMemoryRecordCandidateMaterial<string> {
	return Object.freeze({
		kind: "agentic-memory-record-candidate-material" as const,
		operation: "create" as const,
		operationVersion: 1 as const,
		record,
		sourceRefs: Object.freeze([
			Object.freeze({
				kind: "closed-task-profile-host-outcome",
				id: empiricalStrictJsonDigest(coldOutcome),
			}),
		]),
		evidenceRefs: Object.freeze([
			Object.freeze({
				kind: "independent-verifier",
				id: coldOutcome.verifierEvidenceRefs[0]?.digest ?? empiricalStrictJsonDigest(coldOutcome),
			}),
		]),
		metadata: Object.freeze({ reflectionRevision: B112_MATCHED_BLOCK_MEMORY_REVISION }),
	});
}

function workItem(request: EmpiricalModelTurnRequestV1): WorkItemProjection {
	return Object.freeze({
		workItemId: request.taskRef,
		authoringRevision: 1,
		executionInputRevision: 1,
		lastEventId: `b112-work-item-event-${request.taskRef}`,
		summary: `Complete preregistered task ${request.taskRef}`,
		acceptanceCriteria: Object.freeze([
			Object.freeze({
				criterionId: `b112-acceptance-${request.taskRef}`,
				statement: "The independent closed verifier accepts the target artifact.",
				required: true,
			}),
		]),
		sourceRefs: Object.freeze([
			Object.freeze({ kind: "empirical-campaign-task", id: request.taskDigest }),
		]),
	});
}

function evidence(
	request: EmpiricalModelTurnRequestV1,
	coldOutcome: ClosedTaskProfileHostRunOutcomeV3,
	materials: Readonly<{
		relevant: AgenticMemoryRecordCandidateMaterial<string>;
		irrelevant: AgenticMemoryRecordCandidateMaterial<string>;
		wrongScope: AgenticMemoryRecordCandidateMaterial<string>;
	}>,
): WorkItemEvidenceRecorded {
	return Object.freeze({
		kind: "work-item-evidence-recorded",
		evidenceId: `b112-cold-failure-${request.taskRef}`,
		workItemId: request.taskRef,
		effectRunId: `b112-cold-effect-${request.taskRef}`,
		effectRunResultId: `b112-cold-result-${request.taskRef}`,
		executionInputRevision: 1,
		status: "failed",
		error: Object.freeze({
			kind: "issue",
			code: coldOutcome.issueCodes[0] ?? "target-artifact-mismatch",
			message: "The independent closed verifier rejected the previous target artifact.",
			severity: "error",
		}),
		issues: Object.freeze(
			coldOutcome.issueCodes.map((code) =>
				Object.freeze({
					kind: "issue" as const,
					code,
					message: "Bounded cold-run issue.",
					severity: "error" as const,
				}),
			),
		),
		metadata: { reflectedCandidateMaterials: materials },
	});
}

function mappingPolicy(
	branchKind: EmpiricalWarmBranchKind,
	variant: "relevant" | "irrelevant" | "wrongScope",
	evidenceId: string,
): AgenticWorkItemMemoryMappingPolicy<string> {
	return Object.freeze({
		kind: "agentic-work-item-memory-mapping-policy",
		policyId: `b112-mapping-policy-${branchKind}`,
		recordRules: Object.freeze([
			Object.freeze({
				ruleId: `b112-record-rule-${branchKind}`,
				candidateMaterialFrom: Object.freeze({
					input: "evidence",
					refId: evidenceId,
					path: Object.freeze(["metadata", "reflectedCandidateMaterials", variant]),
				}),
				reason: "Independent verifier failure emitted deterministic candidate material.",
				evidenceRefs: Object.freeze([
					Object.freeze({ kind: "work-item-evidence", id: evidenceId }),
				]),
			}),
		]),
		scoreRules: Object.freeze([]),
	});
}

function admissionPolicy(
	branchKind: EmpiricalWarmBranchKind,
	admit: boolean,
): AgenticMemoryRecordAdmissionPolicy {
	return Object.freeze({
		kind: "agentic-memory-record-admission-policy",
		policyId: `b112-admission-policy-${branchKind}`,
		defaultState: admit ? "admitted" : "rejected",
	});
}

function applicationPolicy(
	branchKind: EmpiricalWarmBranchKind,
): AgenticMemoryRecordApplicationPolicy {
	return Object.freeze({
		kind: "agentic-memory-record-application-policy",
		policyId: `b112-application-policy-${branchKind}`,
		requireAdmittedState: true,
		rejectDuplicateRecordIds: true,
		rejectDuplicateFragmentIds: true,
	});
}

function graphRetrieval(
	branchKind: EmpiricalWarmBranchKind,
	records: readonly AgenticMemoryRecord<string>[],
	request: EmpiricalModelTurnRequestV1,
): {
	readonly retrieved: readonly AgenticMemoryRecord<string>[];
	readonly topologyDigest: string;
} {
	const owner = graph();
	const recordState = owner.state(records, { name: `b112/${branchKind}/records` });
	const useRequest = Object.freeze({
		format: "graphrefly.agenticMemoryRecordUseRequest" as const,
		version: 1 as const,
		requestId: `b112-use-request-${branchKind}`,
		subject: { kind: "actor", id: request.configurationRef },
		purpose: { kind: "purpose", id: "matched-warm-rerun" },
		scope: { kind: "campaign", id: request.campaignRef },
		sourceRevisions: [
			{ kind: "reflection", id: request.taskRef, revision: B112_MATCHED_BLOCK_MEMORY_REVISION },
		],
		policyCoordinates: [
			{ kind: "use-policy", id: "b112-warm-use", revision: B112_MATCHED_BLOCK_MEMORY_REVISION },
		],
		authorityCoordinates: [
			{ kind: "host", id: "d659", revision: B112_MATCHED_BLOCK_MEMORY_REVISION },
		],
	});
	const requestState = owner.state(useRequest, { name: `b112/${branchKind}/useRequest` });
	const decisions = records.map((record, index) =>
		createAgenticMemoryRecordUseDecision(useRequest, record, {
			decisionId: `b112-use-decision-${branchKind}-${index}`,
			state: "allowed",
		}),
	);
	const decisionState = owner.state(decisions, { name: `b112/${branchKind}/useDecisions` });
	const gate = agenticMemoryRecordUseGateBundle(owner, {
		name: `b112/${branchKind}/useGate`,
		records: recordState,
		request: requestState,
		decisions: decisionState,
	});
	const memory = agenticMemoryBundle<string>(owner, {
		name: `b112/${branchKind}/memory`,
		records: gate.allowedRecords,
		query: owner.state({ tags: [RETRIEVAL_TAG], limit: 4 }, { name: `b112/${branchKind}/query` }),
	});
	const context = collectLatest<AgenticMemoryContext<string>>(memory.context);
	try {
		recordState.set(Object.freeze([...records]));
		const latest = context.latest();
		const topology = owner.describe();
		return Object.freeze({
			retrieved: Object.freeze(
				(latest?.entries ?? []).flatMap((entry) =>
					entry.record === undefined
						? []
						: records.filter((record) => record.id === entry.record?.recordId),
				),
			),
			topologyDigest: empiricalStrictJsonDigest({
				nodes: topology.nodes.map((node) => ({ id: node.id, factory: node.factory })),
				edges: topology.edges,
			}),
		});
	} finally {
		context.close();
	}
}

function branchDefinition(branchKind: EmpiricalWarmBranchKind): {
	readonly variant: "relevant" | "irrelevant" | "wrongScope";
	readonly mode: "proposal-only" | "reject" | "admit";
} {
	if (branchKind === "proposal-only") return { variant: "relevant", mode: "proposal-only" };
	if (branchKind === "admission-rejected") return { variant: "relevant", mode: "reject" };
	if (branchKind === "irrelevant-applied") return { variant: "irrelevant", mode: "admit" };
	if (branchKind === "wrong-scope-applied") return { variant: "wrongScope", mode: "admit" };
	return { variant: "relevant", mode: "admit" };
}

export function prepareB112MatchedBlockReflection(input: {
	readonly coldRequest: EmpiricalModelTurnRequestV1;
	readonly coldOutcome: ClosedTaskProfileHostRunOutcomeV3;
}): B112MatchedBlockReflectionV2 {
	if (input.coldOutcome.verifierVerdict !== "failed") {
		throw new TypeError("B112 matched warm branches require a verified cold failure");
	}
	const records = {
		relevant: reflectedRecord("relevant", input.coldRequest, input.coldOutcome),
		irrelevant: reflectedRecord("irrelevant", input.coldRequest, input.coldOutcome),
		wrongScope: reflectedRecord("wrong-scope", input.coldRequest, input.coldOutcome),
	};
	const materials = {
		relevant: candidateMaterial(records.relevant, input.coldOutcome),
		irrelevant: candidateMaterial(records.irrelevant, input.coldOutcome),
		wrongScope: candidateMaterial(records.wrongScope, input.coldOutcome),
	};
	const reflectedEvidence = evidence(
		input.coldRequest,
		input.coldOutcome,
		Object.freeze(materials),
	);
	const branches = BRANCHES.map((branchKind): B112PreparedWarmBranchV2 => {
		const definition = branchDefinition(branchKind);
		const selectedMaterial = materials[definition.variant];
		const recipeInput = {
			workItem: workItem(input.coldRequest),
			policy: mappingPolicy(branchKind, definition.variant, reflectedEvidence.evidenceId),
			evidence: Object.freeze([reflectedEvidence]),
			outcomes: Object.freeze([]),
			records: Object.freeze([]),
			evaluation: 1,
		} as const;
		const recipe =
			definition.mode === "proposal-only"
				? mapAgenticWorkItemMemoryApplicationRecipe<unknown, string>(recipeInput)
				: mapAgenticWorkItemMemoryApplicationRecipe<unknown, string>({
						...recipeInput,
						admissionPolicy: admissionPolicy(branchKind, definition.mode === "admit"),
						applicationPolicy: applicationPolicy(branchKind),
					});
		const proposed = recipe.proposals.map((proposal) => proposal.candidateMaterial.record);
		const admitted = recipe.admission?.admitted.map((item) => item.candidateMaterial.record) ?? [];
		const rejected = recipe.admission?.rejected.map((item) => item.candidateMaterial.record) ?? [];
		const applied = recipe.application?.appliedRecords ?? [];
		const retrieval = graphRetrieval(branchKind, applied, input.coldRequest);
		const selected = selectedMaterial.record;
		const retrievedSelected = retrieval.retrieved.some((record) => record.id === selected.id);
		const wrongScope = selected.scope?.projectId !== input.coldRequest.campaignRef;
		const irrelevant = !selected.fragment.tags.includes("b112-relevant");
		const used = retrievedSelected && !wrongScope && !irrelevant;
		const digestRecords = (items: readonly AgenticMemoryRecord<string>[]) =>
			Object.freeze(items.map(memoryRecordDigest).sort());
		const proposalState = proposed.some((record) => record.id === selected.id)
			? ("emitted" as const)
			: ("not-emitted" as const);
		const admissionState =
			recipe.admission === undefined
				? ("not-run" as const)
				: admitted.some((record) => record.id === selected.id)
					? ("admitted" as const)
					: rejected.some((record) => record.id === selected.id)
						? ("rejected" as const)
						: ("not-run" as const);
		const applicationState =
			recipe.application === undefined
				? ("not-run" as const)
				: applied.some((record) => record.id === selected.id)
					? ("applied" as const)
					: ("not-applied" as const);
		const lifecycle = strictSnapshot({
			branchKind,
			selectedRecordDigest: memoryRecordDigest(selected),
			proposalState,
			admissionState,
			applicationState,
			retrievalState: retrievedSelected ? ("retrieved" as const) : ("not-retrieved" as const),
			plannerRoute: used ? ("memory-guided" as const) : ("baseline" as const),
			traceMemoryDisposition: used
				? ("delivered" as const)
				: retrievedSelected && wrongScope
					? ("rejected-scope" as const)
					: retrievedSelected && irrelevant
						? ("rejected-irrelevant" as const)
						: ("none" as const),
			mapperExplicitCandidates: 0 as const,
			proposalRecordDigests: digestRecords(proposed),
			admissionRecordDigests: digestRecords(admitted),
			applicationRecordDigests: digestRecords(applied),
			retrievalRecordDigests: digestRecords(retrieval.retrieved),
			topologyDigest: retrieval.topologyDigest,
			stagePredicates: {
				cold_run_failed: true,
				memory_record_proposed: proposalState === "emitted",
				memory_record_admitted: admissionState === "admitted",
				memory_record_applied: applicationState === "applied",
				memory_record_retrieved: retrievedSelected,
				warm_run_passed: false,
				warm_decision_trace_includes_memory: false,
				warm_action_trace_bound_to_memory_context: false,
				same_work_item_input: true,
				prior_failure_route_avoided: false,
			},
			caseConforms: false,
			issueCodes: [],
		}) satisfies EmpiricalWarmBranchLifecycleV2;
		return strictSnapshot({
			branchKind,
			lifecycle,
			actorMemoryContext: used
				? {
						recordDigest: memoryRecordDigest(selected),
						text: selected.fragment.payload.slice(0, MAX_MEMORY_TEXT_CHARS),
					}
				: null,
		});
	});
	return strictSnapshot({
		evidenceDigest: empiricalStrictJsonDigest({
			evidenceId: reflectedEvidence.evidenceId,
			workItemId: reflectedEvidence.workItemId,
			status: reflectedEvidence.status,
			issueCodes: input.coldOutcome.issueCodes,
			candidateRecordDigests: Object.values(records).map(memoryRecordDigest).sort(),
		}),
		candidateRecordDigests: Object.freeze(Object.values(records).map(memoryRecordDigest).sort()),
		issueCodes: [],
		branches,
	});
}

function historicalTransferText(memory: D689TransferMemoryV1): string {
	const section = (label: string, rules: D689TransferMemoryV1["triggerConditions"]) =>
		`${label}: ${rules.map((rule) => rule.statement).join(" ")}`;
	const text = [
		"A separately verified source WorkItem established the following transferable guidance.",
		section("Trigger conditions", memory.triggerConditions),
		section("Diagnostic discriminators", memory.diagnosticDiscriminators),
		section("Correction principles", memory.correctionPrinciples),
		section("Validation strategy", memory.validationStrategy),
		section("Known bad routes", memory.knownBadRouteContraindications),
		section("Applicability", memory.applicabilityScope),
		"Treat this as bounded generalized evidence: inspect the current target and independently validate every action.",
	].join(" ");
	if (text.length > MAX_MEMORY_TEXT_CHARS) {
		throw new TypeError("D691 actor-visible transfer memory exceeds its frozen text bound");
	}
	return text;
}

function historicalRecord(
	variant: "relevant" | "irrelevant" | "wrong-scope",
	request: EmpiricalModelTurnRequestV1,
	memory: D689TransferMemoryV1,
	offlineEvidenceDigest: string,
): AgenticMemoryRecord<string> {
	const relevant = variant !== "irrelevant";
	const projectId =
		variant === "wrong-scope" ? `${request.campaignRef}-unrelated-project` : request.campaignRef;
	return Object.freeze({
		id: `d691-memory-record-${variant}`,
		kind: "procedural" as const,
		persistenceLevel: "project" as const,
		artifactKind: "procedure" as const,
		scope: Object.freeze({ projectId }),
		fragment: Object.freeze({
			id: `d691-memory-fragment-${variant}`,
			payload: relevant
				? historicalTransferText(memory)
				: "For an unrelated presentation task, keep headings parallel and the final summary concise.",
			tNs: 1n,
			confidence: 1,
			tags: Object.freeze([
				RETRIEVAL_TAG,
				relevant ? "b112-relevant" : "b112-irrelevant",
				`d691-source-work-item:${memory.sourceTaskRef}`,
			]),
			sources: Object.freeze([
				`d690-offline-evidence:${offlineEvidenceDigest}`,
				...memory.sourceEvidenceDigests.map((entry) => `d690-source-evidence:${entry}`),
			]),
			provenance: memory.memoryRevision,
		}),
	});
}

function historicalCandidateMaterial(
	record: AgenticMemoryRecord<string>,
	memory: D689TransferMemoryV1,
	offlineEvidenceDigest: string,
): AgenticMemoryRecordCandidateMaterial<string> {
	return Object.freeze({
		kind: "agentic-memory-record-candidate-material" as const,
		operation: "create" as const,
		operationVersion: 1 as const,
		record,
		sourceRefs: Object.freeze([
			Object.freeze({ kind: "d690-source-work-item", id: memory.sourceTaskRef }),
		]),
		evidenceRefs: Object.freeze([
			Object.freeze({ kind: "d690-offline-qualification", id: offlineEvidenceDigest }),
			...memory.sourceEvidenceDigests.map((id) =>
				Object.freeze({ kind: "verified-source-evidence", id }),
			),
		]),
		metadata: Object.freeze({ reflectionRevision: memory.memoryRevision }),
	});
}

/** Builds D691's five warm branches through the existing AgenticMemory lifecycle. */
export function prepareD691HistoricalTransferReflection(input: {
	readonly coldRequest: EmpiricalModelTurnRequestV1;
	readonly coldOutcome: ClosedTaskProfileHostRunOutcomeV3;
	readonly transferMemory: D689TransferMemoryV1;
	readonly d690OfflineEvidenceDigest: string;
}): B112MatchedBlockReflectionV2 {
	if (input.coldOutcome.verifierVerdict !== "failed") {
		throw new TypeError("D691 warm branches require a verified cold target failure");
	}
	const records = {
		relevant: historicalRecord(
			"relevant",
			input.coldRequest,
			input.transferMemory,
			input.d690OfflineEvidenceDigest,
		),
		irrelevant: historicalRecord(
			"irrelevant",
			input.coldRequest,
			input.transferMemory,
			input.d690OfflineEvidenceDigest,
		),
		wrongScope: historicalRecord(
			"wrong-scope",
			input.coldRequest,
			input.transferMemory,
			input.d690OfflineEvidenceDigest,
		),
	};
	const materials = {
		relevant: historicalCandidateMaterial(
			records.relevant,
			input.transferMemory,
			input.d690OfflineEvidenceDigest,
		),
		irrelevant: historicalCandidateMaterial(
			records.irrelevant,
			input.transferMemory,
			input.d690OfflineEvidenceDigest,
		),
		wrongScope: historicalCandidateMaterial(
			records.wrongScope,
			input.transferMemory,
			input.d690OfflineEvidenceDigest,
		),
	};
	const evidenceId = `d691-source-success-${input.transferMemory.sourceTaskRef}`;
	const sourceEvidence: WorkItemEvidenceRecorded = Object.freeze({
		kind: "work-item-evidence-recorded",
		evidenceId,
		// The bridge is intentionally WorkItem-local. D691 therefore records a target-scoped
		// transfer-admission fact whose source refs remain bound to the distinct verified source.
		workItemId: input.coldRequest.taskRef,
		effectRunId: `d691-transfer-effect-${input.coldRequest.taskRef}`,
		effectRunResultId: `d691-transfer-result-${input.coldRequest.taskRef}`,
		executionInputRevision: 1,
		status: "completed",
		sourceRefs: Object.freeze(
			input.transferMemory.sourceEvidenceDigests.map((id) =>
				Object.freeze({ kind: "verified-source-evidence", id }),
			),
		),
		metadata: { reflectedCandidateMaterials: Object.freeze(materials) },
	});
	const branches = BRANCHES.map((branchKind): B112PreparedWarmBranchV2 => {
		const definition = branchDefinition(branchKind);
		const selectedMaterial = materials[definition.variant];
		const recipeInput = {
			workItem: workItem(input.coldRequest),
			policy: mappingPolicy(branchKind, definition.variant, evidenceId),
			evidence: Object.freeze([sourceEvidence]),
			outcomes: Object.freeze([]),
			records: Object.freeze([]),
			evaluation: 1,
		} as const;
		const recipe =
			definition.mode === "proposal-only"
				? mapAgenticWorkItemMemoryApplicationRecipe<unknown, string>(recipeInput)
				: mapAgenticWorkItemMemoryApplicationRecipe<unknown, string>({
						...recipeInput,
						admissionPolicy: admissionPolicy(branchKind, definition.mode === "admit"),
						applicationPolicy: applicationPolicy(branchKind),
					});
		const proposed = recipe.proposals.map((proposal) => proposal.candidateMaterial.record);
		const admitted = recipe.admission?.admitted.map((item) => item.candidateMaterial.record) ?? [];
		const rejected = recipe.admission?.rejected.map((item) => item.candidateMaterial.record) ?? [];
		const applied = recipe.application?.appliedRecords ?? [];
		const retrieval = graphRetrieval(branchKind, applied, input.coldRequest);
		const selected = selectedMaterial.record;
		const retrievedSelected = retrieval.retrieved.some((record) => record.id === selected.id);
		const wrongScope = selected.scope?.projectId !== input.coldRequest.campaignRef;
		const irrelevant = !selected.fragment.tags.includes("b112-relevant");
		const used = retrievedSelected && !wrongScope && !irrelevant;
		const digestRecords = (items: readonly AgenticMemoryRecord<string>[]) =>
			Object.freeze(items.map(memoryRecordDigest).sort());
		const proposalState = proposed.some((record) => record.id === selected.id)
			? ("emitted" as const)
			: ("not-emitted" as const);
		const admissionState =
			recipe.admission === undefined
				? ("not-run" as const)
				: admitted.some((record) => record.id === selected.id)
					? ("admitted" as const)
					: rejected.some((record) => record.id === selected.id)
						? ("rejected" as const)
						: ("not-run" as const);
		const applicationState =
			recipe.application === undefined
				? ("not-run" as const)
				: applied.some((record) => record.id === selected.id)
					? ("applied" as const)
					: ("not-applied" as const);
		const lifecycle = strictSnapshot({
			branchKind,
			selectedRecordDigest: memoryRecordDigest(selected),
			proposalState,
			admissionState,
			applicationState,
			retrievalState: retrievedSelected ? ("retrieved" as const) : ("not-retrieved" as const),
			plannerRoute: used ? ("memory-guided" as const) : ("baseline" as const),
			traceMemoryDisposition: used
				? ("delivered" as const)
				: retrievedSelected && wrongScope
					? ("rejected-scope" as const)
					: retrievedSelected && irrelevant
						? ("rejected-irrelevant" as const)
						: ("none" as const),
			mapperExplicitCandidates: 0 as const,
			proposalRecordDigests: digestRecords(proposed),
			admissionRecordDigests: digestRecords(admitted),
			applicationRecordDigests: digestRecords(applied),
			retrievalRecordDigests: digestRecords(retrieval.retrieved),
			topologyDigest: retrieval.topologyDigest,
			stagePredicates: {
				cold_run_failed: true,
				memory_record_proposed: proposalState === "emitted",
				memory_record_admitted: admissionState === "admitted",
				memory_record_applied: applicationState === "applied",
				memory_record_retrieved: retrievedSelected,
				warm_run_passed: false,
				warm_decision_trace_includes_memory: false,
				warm_action_trace_bound_to_memory_context: false,
				// Cold and warm execute the same target WorkItem input. The historical
				// source remains distinct through D690 source/evidence coordinates.
				same_work_item_input: true,
				prior_failure_route_avoided: false,
			},
			caseConforms: false,
			issueCodes: [],
		}) satisfies EmpiricalWarmBranchLifecycleV2;
		return strictSnapshot({
			branchKind,
			lifecycle,
			actorMemoryContext: used
				? {
						recordDigest: memoryRecordDigest(selected),
						text: selected.fragment.payload,
					}
				: null,
		});
	});
	const candidateRecordDigests = Object.freeze(
		Object.values(records).map(memoryRecordDigest).sort(),
	);
	return strictSnapshot({
		evidenceDigest: empiricalStrictJsonDigest({
			evidenceId,
			sourceTaskRef: input.transferMemory.sourceTaskRef,
			targetTaskRef: input.coldRequest.taskRef,
			transferMemoryDigest: empiricalStrictJsonDigest(input.transferMemory),
			d690OfflineEvidenceDigest: input.d690OfflineEvidenceDigest,
			candidateRecordDigests,
		}),
		candidateRecordDigests,
		issueCodes: [],
		branches,
	});
}

export type B112WarmBranchInputV2 = Omit<EmpiricalWarmBranchObservationV3, "attempted" | "run">;
