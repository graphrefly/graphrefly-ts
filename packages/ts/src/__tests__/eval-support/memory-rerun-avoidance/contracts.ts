import type { AgenticMemoryPackedContext } from "../../../solutions/agentic-memory/index.js";

export type EvalLane = "deterministic";
export type EvalRoute = "unsafe-direct-edit" | "memory-guided-verify-first";
export type EvalCaseKind =
	| "relevant-applied"
	| "proposal-only"
	| "admission-rejected"
	| "irrelevant-applied"
	| "wrong-scope-applied";

export type PlannerTraceEvent =
	| {
			readonly event: "planner-start" | "route-selected";
			readonly route: EvalRoute;
			readonly reasonCode: string;
	  }
	| {
			readonly event: "memory-considered" | "memory-used" | "memory-rejected";
			readonly recordRef: EvalResultRef;
			readonly reasonCode: string;
	  };

export interface PlannerDecision {
	readonly route: EvalRoute;
	readonly trace: readonly PlannerTraceEvent[];
}

export interface EvalWorld {
	readonly worldRevision: string;
	readonly projectId: string;
	readonly requiresVerificationBeforeEdit: boolean;
}

export interface EvalExecutionOutcome {
	readonly resultId: string;
	readonly effectRunId: string;
	readonly runRef: string;
	readonly runStage: "cold" | "warm";
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly projectId: string;
	readonly route: EvalRoute;
	readonly status: "completed" | "failed";
	readonly facts: {
		readonly verificationPerformedBeforeEdit: boolean;
		readonly editPerformed: boolean;
	};
	readonly issueCodes: readonly string[];
}

export interface EvalCriterionVerification {
	readonly criterionId: string;
	readonly required: boolean;
	readonly satisfied: boolean;
	readonly evidenceRefs: readonly EvalResultRef[];
}

export interface EvalVerification {
	readonly verificationId: string;
	readonly workItemId: string;
	readonly satisfied: boolean;
	readonly criteria: readonly EvalCriterionVerification[];
	readonly issueCodes: readonly string[];
}

export interface EvalScope {
	readonly familyRef: string;
	readonly lane: EvalLane;
	readonly projectId: string;
	readonly requiredCriterionIds: readonly string[];
}

export interface EvalInputCoordinates {
	readonly workItemDigest: string;
	readonly worldDigest: string;
	readonly worldRevision: string;
	readonly plannerRevision: string;
	readonly executorRevision: string;
	readonly verifierRevision: string;
	readonly reflectorRevision: string;
	readonly mapperRevision: string;
}

export interface EvalResultRef {
	readonly kind: string;
	readonly id: string;
}

export type ProposalStageState = "emitted" | "not-emitted";
export type AdmissionStageState = "admitted" | "rejected" | "not-run";
export type ApplicationStageState = "applied" | "not-applied" | "not-run";
export type RetrievalStageState = "retrieved" | "not-retrieved";
export type TraceMemoryDisposition = "used" | "rejected-irrelevant" | "rejected-scope" | "none";

export interface EvalCaseExpectation {
	readonly coldRunPassed: false;
	readonly sameWorkItemInput: true;
	readonly mapperExplicitCandidates: 0;
	readonly proposalState: ProposalStageState;
	readonly admissionState: AdmissionStageState;
	readonly applicationState: ApplicationStageState;
	readonly retrievalState: RetrievalStageState;
	readonly warmRunPassed: boolean;
	readonly warmRoute: EvalRoute;
	readonly traceMemoryDisposition: TraceMemoryDisposition;
	readonly priorFailureRouteAvoided: boolean;
}

export interface EvalStagePredicates {
	readonly cold_run_failed: boolean;
	readonly memory_record_proposed: boolean;
	readonly memory_record_admitted: boolean;
	readonly memory_record_applied: boolean;
	readonly memory_record_retrieved: boolean;
	readonly warm_run_passed: boolean;
	readonly warm_decision_trace_includes_memory: boolean;
	readonly same_work_item_input: boolean;
	readonly prior_failure_route_avoided: boolean;
}

export interface EvalRunObservation {
	readonly route: EvalRoute;
	readonly outcomeStatus: "completed" | "failed";
	readonly verifierSatisfied: boolean;
	readonly issueCodes: readonly string[];
	readonly resultRefs: readonly EvalResultRef[];
	readonly decisionTrace: readonly PlannerTraceEvent[];
}

export interface EvalCaseObservationV1 {
	readonly schemaVersion: "graphrefly.private-solution-eval.case-observation.v1";
	readonly familyRef: string;
	readonly caseRef: string;
	readonly caseKind: EvalCaseKind;
	readonly lane: EvalLane;
	readonly required: true;
	readonly input: {
		readonly cold: EvalInputCoordinates;
		readonly warm: EvalInputCoordinates;
	};
	readonly cold: EvalRunObservation;
	readonly reflection: {
		readonly candidateCount: number;
		readonly candidateRecordRefs: readonly EvalResultRef[];
		readonly evidenceRefs: readonly EvalResultRef[];
	};
	readonly memory: {
		readonly proposal: {
			readonly state: ProposalStageState;
			readonly recordRefs: readonly EvalResultRef[];
		};
		readonly admission: {
			readonly state: AdmissionStageState;
			readonly recordRefs: readonly EvalResultRef[];
		};
		readonly application: {
			readonly state: ApplicationStageState;
			readonly recordRefs: readonly EvalResultRef[];
		};
		readonly retrieval: {
			readonly state: RetrievalStageState;
			readonly recordRefs: readonly EvalResultRef[];
		};
		readonly mapperExplicitCandidates: 0;
	};
	readonly warm: EvalRunObservation;
	readonly stagePredicates: EvalStagePredicates;
	readonly canonicalGatePassed: boolean;
	readonly expectation: EvalCaseExpectation;
	readonly caseConforms: boolean;
	readonly issueCodes: readonly string[];
	readonly resultRefs: readonly EvalResultRef[];
}

export interface EvalFamilyScorecardV1 {
	readonly schemaVersion: "graphrefly.private-solution-eval.family-scorecard.v1";
	readonly familyRef: string;
	readonly lane: EvalLane;
	readonly requiredCaseRefs: readonly string[];
	readonly cases: readonly EvalCaseObservationV1[];
	readonly metrics: {
		readonly relevantMemoryLift: {
			readonly coldPassRate: number;
			readonly warmPassRate: number;
			readonly lift: number;
		};
		readonly negativeControlFalsePositiveRate: {
			readonly falsePositives: number;
			readonly controls: number;
			readonly rate: number;
		};
		readonly traceAttribution: {
			readonly attributedRetrievedRecords: number;
			readonly retrievedRecords: number;
			readonly rate: number;
		};
		readonly stageCounts: {
			readonly proposed: number;
			readonly admitted: number;
			readonly admissionRejected: number;
			readonly admissionNotRun: number;
			readonly applied: number;
			readonly applicationNotApplied: number;
			readonly applicationNotRun: number;
			readonly retrieved: number;
		};
	};
	readonly familyPassed: boolean;
	readonly issueCodes: readonly string[];
	readonly resultRefs: readonly EvalResultRef[];
}

export interface PackedMemoryResult {
	readonly packedContext: AgenticMemoryPackedContext;
	readonly retrievedRecordIds: readonly string[];
}
