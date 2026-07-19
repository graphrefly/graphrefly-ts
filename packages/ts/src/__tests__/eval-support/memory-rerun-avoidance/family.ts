import { graph } from "../../../graph/graph.js";
import { strictJsonCodec } from "../../../json/codec.js";
import type { MemoryRetrievalQuery } from "../../../patterns/semantic-memory-graph.js";
import type { Message } from "../../../protocol/messages.js";
import {
	type AgenticMemoryContextPackingPolicy,
	type AgenticMemoryContextText,
	type AgenticMemoryPackedContext,
	type AgenticMemoryRecord,
	type AgenticMemoryRecordAdmissionPolicy,
	type AgenticMemoryRecordApplicationPolicy,
	type AgenticMemoryRecordCandidateMaterial,
	agenticMemoryBundle,
	agenticMemoryContextPackingBundle,
} from "../../../solutions/agentic-memory/index.js";
import type { AgenticWorkItemMemoryMappingPolicy } from "../../../solutions/agentic-work-item-memory/index.js";
import { mapAgenticWorkItemMemoryApplicationRecipe } from "../../../solutions/agentic-work-item-memory-application/index.js";
import type { WorkItemProjection } from "../../../solutions/work-item/index.js";
import {
	boundedIssueCodes,
	boundedResultRefs,
	evalId,
	workItemDigest,
	worldDigest,
} from "./canonical.js";
import type {
	AdmissionStageState,
	ApplicationStageState,
	EvalCaseExpectation,
	EvalCaseKind,
	EvalCaseObservationV1,
	EvalFamilyScorecardV1,
	EvalInputCoordinates,
	EvalResultRef,
	EvalStagePredicates,
	PackedMemoryResult,
	PlannerDecision,
	PlannerTraceEvent,
	ProposalStageState,
	RetrievalStageState,
	TraceMemoryDisposition,
} from "./contracts.js";
import { MEMORY_RERUN_AVOIDANCE_CASE_REFS, MEMORY_RERUN_AVOIDANCE_SCHEMAS } from "./identity.js";
import {
	buildEvalScope,
	buildWorkItem,
	buildWorld,
	executeRoute,
	FAMILY_REF,
	packedTextMetadata,
	planRoute,
	RETRIEVAL_TAG,
	REVISIONS,
	reflectFailure,
	toEffectRunResult,
	verificationIssueCodes,
	verifyOutcome,
} from "./stages.js";

type ReflectionVariant = "relevant" | "irrelevant" | "wrongScope";
type AdmissionMode = "proposal-only" | "reject" | "admit";

interface EvalCaseDefinition {
	readonly caseKind: EvalCaseKind;
	readonly caseRef: string;
	readonly variant: ReflectionVariant;
	readonly admissionMode: AdmissionMode;
	readonly expectation: EvalCaseExpectation;
}

const expected = (
	value: Omit<
		EvalCaseExpectation,
		"coldRunPassed" | "sameWorkItemInput" | "mapperExplicitCandidates"
	>,
): EvalCaseExpectation =>
	Object.freeze({
		coldRunPassed: false,
		sameWorkItemInput: true,
		mapperExplicitCandidates: 0,
		...value,
	});

export const CASE_DEFINITIONS: readonly EvalCaseDefinition[] = Object.freeze([
	Object.freeze({
		caseKind: "relevant-applied",
		caseRef: MEMORY_RERUN_AVOIDANCE_CASE_REFS.relevantApplied,
		variant: "relevant",
		admissionMode: "admit",
		expectation: expected({
			proposalState: "emitted",
			admissionState: "admitted",
			applicationState: "applied",
			retrievalState: "retrieved",
			warmRunPassed: true,
			warmRoute: "memory-guided-verify-first",
			traceMemoryDisposition: "used",
			priorFailureRouteAvoided: true,
		}),
	}),
	Object.freeze({
		caseKind: "proposal-only",
		caseRef: MEMORY_RERUN_AVOIDANCE_CASE_REFS.proposalOnly,
		variant: "relevant",
		admissionMode: "proposal-only",
		expectation: expected({
			proposalState: "emitted",
			admissionState: "not-run",
			applicationState: "not-run",
			retrievalState: "not-retrieved",
			warmRunPassed: false,
			warmRoute: "unsafe-direct-edit",
			traceMemoryDisposition: "none",
			priorFailureRouteAvoided: false,
		}),
	}),
	Object.freeze({
		caseKind: "admission-rejected",
		caseRef: MEMORY_RERUN_AVOIDANCE_CASE_REFS.admissionRejected,
		variant: "relevant",
		admissionMode: "reject",
		expectation: expected({
			proposalState: "emitted",
			admissionState: "rejected",
			applicationState: "not-applied",
			retrievalState: "not-retrieved",
			warmRunPassed: false,
			warmRoute: "unsafe-direct-edit",
			traceMemoryDisposition: "none",
			priorFailureRouteAvoided: false,
		}),
	}),
	Object.freeze({
		caseKind: "irrelevant-applied",
		caseRef: MEMORY_RERUN_AVOIDANCE_CASE_REFS.irrelevantApplied,
		variant: "irrelevant",
		admissionMode: "admit",
		expectation: expected({
			proposalState: "emitted",
			admissionState: "admitted",
			applicationState: "applied",
			retrievalState: "retrieved",
			warmRunPassed: false,
			warmRoute: "unsafe-direct-edit",
			traceMemoryDisposition: "rejected-irrelevant",
			priorFailureRouteAvoided: false,
		}),
	}),
	Object.freeze({
		caseKind: "wrong-scope-applied",
		caseRef: MEMORY_RERUN_AVOIDANCE_CASE_REFS.wrongScopeApplied,
		variant: "wrongScope",
		admissionMode: "admit",
		expectation: expected({
			proposalState: "emitted",
			admissionState: "admitted",
			applicationState: "applied",
			retrievalState: "retrieved",
			warmRunPassed: false,
			warmRoute: "unsafe-direct-edit",
			traceMemoryDisposition: "rejected-scope",
			priorFailureRouteAvoided: false,
		}),
	}),
]);

const data = <T>(messages: Message[]): T[] =>
	messages.filter((message) => message[0] === "DATA").map((message) => message[1] as T);

function collect(node: { subscribe(sink: (message: Message) => void): () => void }) {
	const messages: Message[] = [];
	const unsubscribe = node.subscribe((message) => messages.push(message));
	return { messages, unsubscribe };
}

function emptyPackedContext(): AgenticMemoryPackedContext {
	return Object.freeze({
		entries: Object.freeze([]),
		text: "",
		totalChars: 0,
		totalCost: 0,
		truncated: false,
	});
}

function packAppliedMemory(
	recordsToPack: readonly AgenticMemoryRecord<string>[],
): PackedMemoryResult {
	const g = graph();
	const records = g.state<readonly AgenticMemoryRecord<string>[]>([], {
		name: "b105/appliedMemoryRecords",
	});
	const query = g.state<MemoryRetrievalQuery>(
		{ tags: [RETRIEVAL_TAG], limit: 4 },
		{ name: "b105/memoryQuery" },
	);
	const memory = agenticMemoryBundle<string>(g, {
		name: "b105/memory",
		records,
		query,
	});
	const texts = g.state<readonly AgenticMemoryContextText[]>([], {
		name: "b105/contextTexts",
	});
	const policy = g.state<AgenticMemoryContextPackingPolicy>(
		{ maxEntries: 4, includeMetadata: true },
		{ name: "b105/packingPolicy" },
	);
	const packed = agenticMemoryContextPackingBundle(g, {
		name: "b105/contextPacking",
		context: memory.context,
		texts,
		policy,
	});
	const observed = collect(packed.packedContext);
	try {
		records.set(recordsToPack);
		texts.set(
			recordsToPack.map((record) =>
				Object.freeze({
					fragmentId: record.fragment.id,
					text: record.fragment.payload,
					metadata: packedTextMetadata(record),
				}),
			),
		);
		const packedContext =
			data<AgenticMemoryPackedContext>(observed.messages).at(-1) ?? emptyPackedContext();
		return Object.freeze({
			packedContext,
			retrievedRecordIds: Object.freeze(
				packedContext.entries.flatMap((entry) =>
					entry.record?.recordId === undefined ? [] : [entry.record.recordId],
				),
			),
		});
	} finally {
		observed.unsubscribe();
	}
}

function mappingPolicy(
	caseCoordinate: string,
	variant: ReflectionVariant,
	evidenceId: string,
): AgenticWorkItemMemoryMappingPolicy<string> {
	return Object.freeze({
		kind: "agentic-work-item-memory-mapping-policy",
		policyId: evalId("mapping-policy", REVISIONS.mapper, caseCoordinate),
		recordRules: Object.freeze([
			Object.freeze({
				ruleId: evalId("record-rule", caseCoordinate, variant),
				candidateMaterialFrom: Object.freeze({
					input: "evidence",
					refId: evidenceId,
					path: Object.freeze(["metadata", "reflectedCandidateMaterials", variant]),
				}),
				reason: "Independent verifier failure emitted deterministic candidate material",
				evidenceRefs: Object.freeze([
					Object.freeze({ kind: "work-item-evidence", id: evidenceId }),
				]),
			}),
		]),
		scoreRules: Object.freeze([]),
	});
}

function admissionPolicy(
	caseCoordinate: string,
	mode: Exclude<AdmissionMode, "proposal-only">,
): AgenticMemoryRecordAdmissionPolicy {
	return Object.freeze({
		kind: "agentic-memory-record-admission-policy",
		policyId: evalId("admission-policy", caseCoordinate),
		defaultState: mode === "admit" ? "admitted" : "rejected",
	});
}

function applicationPolicy(caseCoordinate: string): AgenticMemoryRecordApplicationPolicy {
	return Object.freeze({
		kind: "agentic-memory-record-application-policy",
		policyId: evalId("application-policy", caseCoordinate),
	});
}

function resultRef(kind: string, id: string): EvalResultRef {
	return Object.freeze({ kind, id });
}

function traceEntryMatchesRecord(entry: PlannerTraceEvent, recordRef: EvalResultRef): boolean {
	return (
		"recordRef" in entry &&
		entry.recordRef.kind === recordRef.kind &&
		entry.recordRef.id === recordRef.id
	);
}

export function hasExactTraceAttribution(
	trace: readonly PlannerTraceEvent[],
	recordRef: EvalResultRef,
): boolean {
	return (
		trace.filter(
			(entry) =>
				traceEntryMatchesRecord(entry, recordRef) &&
				(entry.event === "memory-used" || entry.event === "memory-rejected"),
		).length === 1
	);
}

function traceDisposition(decision: PlannerDecision, recordId: string): TraceMemoryDisposition {
	const recordRef = resultRef("agentic-memory-record", recordId);
	for (const entry of decision.trace) {
		if (!traceEntryMatchesRecord(entry, recordRef)) continue;
		if (entry.event === "memory-used") return "used";
		if (entry.event === "memory-rejected" && entry.reasonCode === "irrelevant-procedure") {
			return "rejected-irrelevant";
		}
		if (entry.event === "memory-rejected" && entry.reasonCode === "scope-mismatch") {
			return "rejected-scope";
		}
	}
	return "none";
}

function inputsEquivalent(cold: EvalInputCoordinates, warm: EvalInputCoordinates): boolean {
	return (
		cold.workItemDigest === warm.workItemDigest &&
		cold.worldDigest === warm.worldDigest &&
		cold.worldRevision === warm.worldRevision &&
		cold.plannerRevision === warm.plannerRevision &&
		cold.executorRevision === warm.executorRevision &&
		cold.verifierRevision === warm.verifierRevision
	);
}

function inputCoordinates(
	item: WorkItemProjection,
	scope: ReturnType<typeof buildEvalScope>,
	world: ReturnType<typeof buildWorld>,
): EvalInputCoordinates {
	return Object.freeze({
		workItemDigest: workItemDigest(item, scope),
		worldDigest: worldDigest(world),
		worldRevision: world.worldRevision,
		plannerRevision: REVISIONS.planner,
		executorRevision: REVISIONS.executor,
		verifierRevision: REVISIONS.verifier,
		reflectorRevision: REVISIONS.reflector,
		mapperRevision: REVISIONS.mapper,
	});
}

function conforms(
	observation: {
		readonly coldRunPassed: boolean;
		readonly sameWorkItemInput: boolean;
		readonly mapperExplicitCandidates: number;
		readonly proposalState: ProposalStageState;
		readonly admissionState: AdmissionStageState;
		readonly applicationState: ApplicationStageState;
		readonly retrievalState: RetrievalStageState;
		readonly warmRunPassed: boolean;
		readonly warmRoute: PlannerDecision["route"];
		readonly traceMemoryDisposition: TraceMemoryDisposition;
		readonly priorFailureRouteAvoided: boolean;
	},
	expectation: EvalCaseExpectation,
): boolean {
	return (
		observation.coldRunPassed === expectation.coldRunPassed &&
		observation.sameWorkItemInput === expectation.sameWorkItemInput &&
		observation.mapperExplicitCandidates === expectation.mapperExplicitCandidates &&
		observation.proposalState === expectation.proposalState &&
		observation.admissionState === expectation.admissionState &&
		observation.applicationState === expectation.applicationState &&
		observation.retrievalState === expectation.retrievalState &&
		observation.warmRunPassed === expectation.warmRunPassed &&
		observation.warmRoute === expectation.warmRoute &&
		observation.traceMemoryDisposition === expectation.traceMemoryDisposition &&
		observation.priorFailureRouteAvoided === expectation.priorFailureRouteAvoided
	);
}

function runCase(definition: EvalCaseDefinition): EvalCaseObservationV1 {
	const item: WorkItemProjection = buildWorkItem();
	const world = buildWorld();
	const scope = buildEvalScope();
	const coldInputs = inputCoordinates(item, scope, world);
	const coldDecision = planRoute(item, scope);
	const coldOutcome = executeRoute(item, world, coldDecision, definition.caseKind, "cold");
	const coldVerification = verifyOutcome(item, coldOutcome);
	const reflection = reflectFailure(coldVerification, coldOutcome);
	const selectedMaterial: AgenticMemoryRecordCandidateMaterial<string> =
		reflection.candidateMaterials[definition.variant];
	const selectedRecordId = selectedMaterial.record.id;
	const policy = mappingPolicy(
		definition.caseKind,
		definition.variant,
		reflection.evidence.evidenceId,
	);
	const effectResult = toEffectRunResult(coldOutcome);
	const recipeInput = {
		workItem: item,
		policy,
		evidence: Object.freeze([reflection.evidence]),
		outcomes: Object.freeze([effectResult]),
		records: Object.freeze([]),
		evaluation: 105,
	} as const;
	const memoryApplication =
		definition.admissionMode === "proposal-only"
			? mapAgenticWorkItemMemoryApplicationRecipe<unknown, string>(recipeInput)
			: mapAgenticWorkItemMemoryApplicationRecipe<unknown, string>({
					...recipeInput,
					admissionPolicy: admissionPolicy(definition.caseKind, definition.admissionMode),
					applicationPolicy: applicationPolicy(definition.caseKind),
				});
	const proposedRecordRefs = memoryApplication.proposals.map((proposal) =>
		resultRef("agentic-memory-record", proposal.candidateMaterial.record.id),
	);
	const admittedRecordRefs = (memoryApplication.admission?.admitted ?? []).map((admission) =>
		resultRef("agentic-memory-record", admission.candidateMaterial.record.id),
	);
	const rejectedRecordRefs = (memoryApplication.admission?.rejected ?? []).map((admission) =>
		resultRef("agentic-memory-record", admission.candidateMaterial.record.id),
	);
	const appliedRecords = memoryApplication.application?.appliedRecords ?? [];
	const appliedRecordRefs = appliedRecords.map((record) =>
		resultRef("agentic-memory-record", record.id),
	);
	const packed = packAppliedMemory(appliedRecords);
	const retrievedRecordRefs = packed.retrievedRecordIds.map((recordId) =>
		resultRef("agentic-memory-record", recordId),
	);
	const explicitCandidates = memoryApplication.bridge.cursor.explicitCandidates;
	if (explicitCandidates !== 0) {
		throw new Error(
			`B105 mapper explicitCandidates must remain zero; received ${explicitCandidates}`,
		);
	}
	const mapperExplicitCandidates: 0 = 0;
	const warmDecision = planRoute(item, scope, packed.packedContext);
	const warmOutcome = executeRoute(item, world, warmDecision, definition.caseKind, "warm");
	const warmVerification = verifyOutcome(item, warmOutcome);
	const proposalState: ProposalStageState = proposedRecordRefs.some(
		(ref) => ref.id === selectedRecordId,
	)
		? "emitted"
		: "not-emitted";
	const admissionState: AdmissionStageState =
		memoryApplication.admission === undefined
			? "not-run"
			: admittedRecordRefs.some((ref) => ref.id === selectedRecordId)
				? "admitted"
				: rejectedRecordRefs.some((ref) => ref.id === selectedRecordId)
					? "rejected"
					: "not-run";
	const applicationState: ApplicationStageState =
		memoryApplication.application === undefined
			? "not-run"
			: appliedRecordRefs.some((ref) => ref.id === selectedRecordId)
				? "applied"
				: "not-applied";
	const retrievalState: RetrievalStageState = retrievedRecordRefs.some(
		(ref) => ref.id === selectedRecordId,
	)
		? "retrieved"
		: "not-retrieved";
	const disposition = traceDisposition(warmDecision, selectedRecordId);
	const warmInputs = inputCoordinates(item, scope, world);
	const priorFailureRouteAvoided =
		coldDecision.route === "unsafe-direct-edit" &&
		warmDecision.route === "memory-guided-verify-first";
	const stagePredicates: EvalStagePredicates = Object.freeze({
		cold_run_failed: !coldVerification.satisfied,
		memory_record_proposed: proposalState === "emitted",
		memory_record_admitted: admissionState === "admitted",
		memory_record_applied: applicationState === "applied",
		memory_record_retrieved: retrievalState === "retrieved",
		warm_run_passed: warmVerification.satisfied,
		warm_decision_trace_includes_memory: warmDecision.trace.some(
			(entry) => "recordRef" in entry && entry.recordRef.id === selectedRecordId,
		),
		same_work_item_input: inputsEquivalent(coldInputs, warmInputs),
		prior_failure_route_avoided: priorFailureRouteAvoided,
	});
	const canonicalGatePassed =
		stagePredicates.cold_run_failed &&
		stagePredicates.memory_record_applied &&
		stagePredicates.warm_run_passed &&
		stagePredicates.warm_decision_trace_includes_memory;
	const caseConforms = conforms(
		{
			coldRunPassed: coldVerification.satisfied,
			sameWorkItemInput: stagePredicates.same_work_item_input,
			mapperExplicitCandidates,
			proposalState,
			admissionState,
			applicationState,
			retrievalState,
			warmRunPassed: warmVerification.satisfied,
			warmRoute: warmDecision.route,
			traceMemoryDisposition: disposition,
			priorFailureRouteAvoided,
		},
		definition.expectation,
	);
	const reflectionRecordRefs = Object.values(reflection.candidateMaterials).map((material) =>
		resultRef("agentic-memory-record", material.record.id),
	);
	const issueCodes = boundedIssueCodes([
		...verificationIssueCodes(coldVerification, coldOutcome),
		...memoryApplication.bridge.issues.map((issue) => issue.code),
		...(memoryApplication.admission?.issues ?? []).map((issue) => issue.code),
		...(memoryApplication.application?.issues ?? []).map((issue) => issue.code),
		...verificationIssueCodes(warmVerification, warmOutcome),
	]);
	const resultRefs = boundedResultRefs([
		resultRef("effect-run-result", coldOutcome.resultId),
		resultRef("b105-verification", coldVerification.verificationId),
		resultRef("work-item-evidence", reflection.evidence.evidenceId),
		...appliedRecordRefs,
		resultRef("effect-run-result", warmOutcome.resultId),
		resultRef("b105-verification", warmVerification.verificationId),
	]);
	return Object.freeze({
		schemaVersion: MEMORY_RERUN_AVOIDANCE_SCHEMAS.caseObservation,
		familyRef: FAMILY_REF,
		caseRef: definition.caseRef,
		caseKind: definition.caseKind,
		lane: "deterministic",
		required: true,
		input: Object.freeze({ cold: coldInputs, warm: warmInputs }),
		cold: Object.freeze({
			route: coldDecision.route,
			outcomeStatus: coldOutcome.status,
			verifierSatisfied: coldVerification.satisfied,
			issueCodes: verificationIssueCodes(coldVerification, coldOutcome),
			resultRefs: boundedResultRefs([
				resultRef("effect-run-result", coldOutcome.resultId),
				resultRef("b105-verification", coldVerification.verificationId),
			]),
			decisionTrace: coldDecision.trace,
		}),
		reflection: Object.freeze({
			candidateCount: reflectionRecordRefs.length,
			candidateRecordRefs: boundedResultRefs(reflectionRecordRefs),
			evidenceRefs: Object.freeze([
				resultRef("work-item-evidence", reflection.evidence.evidenceId),
			]),
		}),
		memory: Object.freeze({
			proposal: Object.freeze({
				state: proposalState,
				recordRefs: boundedResultRefs(proposedRecordRefs),
			}),
			admission: Object.freeze({
				state: admissionState,
				recordRefs: boundedResultRefs([...admittedRecordRefs, ...rejectedRecordRefs]),
			}),
			application: Object.freeze({
				state: applicationState,
				recordRefs: boundedResultRefs(appliedRecordRefs),
			}),
			retrieval: Object.freeze({
				state: retrievalState,
				recordRefs: boundedResultRefs(retrievedRecordRefs),
			}),
			mapperExplicitCandidates,
		}),
		warm: Object.freeze({
			route: warmDecision.route,
			outcomeStatus: warmOutcome.status,
			verifierSatisfied: warmVerification.satisfied,
			issueCodes: verificationIssueCodes(warmVerification, warmOutcome),
			resultRefs: boundedResultRefs([
				resultRef("effect-run-result", warmOutcome.resultId),
				resultRef("b105-verification", warmVerification.verificationId),
			]),
			decisionTrace: warmDecision.trace,
		}),
		stagePredicates,
		canonicalGatePassed,
		expectation: definition.expectation,
		caseConforms,
		issueCodes,
		resultRefs,
	});
}

export function runMemoryRerunAvoidanceFamily(): EvalFamilyScorecardV1 {
	const cases = Object.freeze(CASE_DEFINITIONS.map(runCase));
	const relevant = cases.find((observation) => observation.caseKind === "relevant-applied");
	if (relevant === undefined) throw new Error("B105 family requires the relevant-applied case");
	const negativeControls = cases.filter(
		(observation) => observation.caseKind !== "relevant-applied",
	);
	const falsePositives = negativeControls.filter(
		(observation) => observation.stagePredicates.warm_run_passed,
	).length;
	const retrievedRecords = cases.reduce(
		(total, observation) => total + observation.memory.retrieval.recordRefs.length,
		0,
	);
	const attributedRetrievedRecords = cases.reduce(
		(total, observation) =>
			total +
			observation.memory.retrieval.recordRefs.filter((recordRef) =>
				hasExactTraceAttribution(observation.warm.decisionTrace, recordRef),
			).length,
		0,
	);
	const stageCounts = Object.freeze({
		proposed: cases.filter((observation) => observation.memory.proposal.state === "emitted").length,
		admitted: cases.filter((observation) => observation.memory.admission.state === "admitted")
			.length,
		admissionRejected: cases.filter(
			(observation) => observation.memory.admission.state === "rejected",
		).length,
		admissionNotRun: cases.filter((observation) => observation.memory.admission.state === "not-run")
			.length,
		applied: cases.filter((observation) => observation.memory.application.state === "applied")
			.length,
		applicationNotApplied: cases.filter(
			(observation) => observation.memory.application.state === "not-applied",
		).length,
		applicationNotRun: cases.filter(
			(observation) => observation.memory.application.state === "not-run",
		).length,
		retrieved: cases.filter((observation) => observation.memory.retrieval.state === "retrieved")
			.length,
	});
	const familyPassed = cases.every((observation) => observation.caseConforms);
	return Object.freeze({
		schemaVersion: MEMORY_RERUN_AVOIDANCE_SCHEMAS.familyScorecard,
		familyRef: FAMILY_REF,
		lane: "deterministic",
		requiredCaseRefs: Object.freeze(cases.map((observation) => observation.caseRef)),
		cases,
		metrics: Object.freeze({
			relevantMemoryLift: Object.freeze({
				coldPassRate: relevant.cold.verifierSatisfied ? 1 : 0,
				warmPassRate: relevant.warm.verifierSatisfied ? 1 : 0,
				lift: (relevant.warm.verifierSatisfied ? 1 : 0) - (relevant.cold.verifierSatisfied ? 1 : 0),
			}),
			negativeControlFalsePositiveRate: Object.freeze({
				falsePositives,
				controls: negativeControls.length,
				rate: negativeControls.length === 0 ? 0 : falsePositives / negativeControls.length,
			}),
			traceAttribution: Object.freeze({
				attributedRetrievedRecords,
				retrievedRecords,
				rate: retrievedRecords === 0 ? 0 : attributedRetrievedRecords / retrievedRecords,
			}),
			stageCounts,
		}),
		familyPassed,
		issueCodes: boundedIssueCodes(cases.flatMap((observation) => observation.issueCodes)),
		resultRefs: boundedResultRefs(cases.flatMap((observation) => observation.resultRefs)),
	});
}

export function scorecardBytes(scorecard: EvalFamilyScorecardV1): Uint8Array {
	return strictJsonCodec.encode(scorecard);
}

export function canonicalGate(observation: EvalCaseObservationV1): boolean {
	const predicates = observation.stagePredicates;
	return (
		predicates.cold_run_failed &&
		predicates.memory_record_applied &&
		predicates.warm_run_passed &&
		predicates.warm_decision_trace_includes_memory
	);
}

export { evalId, workItemDigest } from "./canonical.js";
export { buildEvalScope, buildWorkItem } from "./stages.js";
