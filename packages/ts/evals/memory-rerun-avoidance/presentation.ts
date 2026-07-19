import type { EvalFamilyScorecardV1 } from "../../src/__tests__/eval-support/memory-rerun-avoidance/contracts.js";
import type {
	MemoryRerunAvoidancePublicationManifestV1,
	SolutionEvalPublicationSourceRef,
} from "./publication.js";
import { validateMemoryRerunAvoidancePublication } from "./publication.js";

export interface MemoryRerunAvoidancePresentationCaseV1 {
	readonly caseRef: string;
	readonly caseKind: string;
	readonly caseConforms: boolean;
	readonly canonicalGatePassed: boolean;
	readonly proposalState: string;
	readonly admissionState: string;
	readonly applicationState: string;
	readonly retrievalState: string;
	readonly warmRunPassed: boolean;
	readonly sameWorkItemInput: boolean;
	readonly priorFailureRouteAvoided: boolean;
}

export interface MemoryRerunAvoidancePresentationV1 {
	readonly schemaVersion: "graphrefly.private-solution-eval.presentation.v1";
	readonly artifactRef: string;
	readonly familyRef: string;
	readonly lane: "deterministic";
	readonly familyPassed: boolean;
	readonly cases: readonly MemoryRerunAvoidancePresentationCaseV1[];
	readonly metrics: EvalFamilyScorecardV1["metrics"];
	readonly issueCodes: readonly string[];
	readonly resultRefs: EvalFamilyScorecardV1["resultRefs"];
	readonly provenance: {
		readonly scorecardSchemaVersion: string;
		readonly scorecardSha256: string;
		readonly canonicalByteLength: number;
		readonly generatorRevision: string;
		readonly sourceRefs: readonly SolutionEvalPublicationSourceRef[];
	};
}

function projectProvenance(manifest: MemoryRerunAvoidancePublicationManifestV1) {
	return Object.freeze({
		scorecardSchemaVersion: manifest.scorecardSchemaVersion,
		scorecardSha256: manifest.scorecardSha256,
		canonicalByteLength: manifest.canonicalByteLength,
		generatorRevision: manifest.generatorRevision,
		sourceRefs: Object.freeze(
			manifest.sourceRefs.map((ref) => Object.freeze({ kind: ref.kind, id: ref.id })),
		),
	});
}

function projectMetrics(
	metrics: EvalFamilyScorecardV1["metrics"],
): EvalFamilyScorecardV1["metrics"] {
	return Object.freeze({
		relevantMemoryLift: Object.freeze({ ...metrics.relevantMemoryLift }),
		negativeControlFalsePositiveRate: Object.freeze({
			...metrics.negativeControlFalsePositiveRate,
		}),
		traceAttribution: Object.freeze({ ...metrics.traceAttribution }),
		stageCounts: Object.freeze({ ...metrics.stageCounts }),
	});
}

export function projectMemoryRerunAvoidancePresentation(
	scorecardBytes: Uint8Array,
	manifestBytes: Uint8Array,
): MemoryRerunAvoidancePresentationV1 {
	const { manifest, scorecard } = validateMemoryRerunAvoidancePublication(
		scorecardBytes,
		manifestBytes,
	);
	return Object.freeze({
		schemaVersion: "graphrefly.private-solution-eval.presentation.v1",
		artifactRef: manifest.artifactRef,
		familyRef: scorecard.familyRef,
		lane: scorecard.lane,
		familyPassed: scorecard.familyPassed,
		cases: Object.freeze(
			scorecard.cases.map((observation) =>
				Object.freeze({
					caseRef: observation.caseRef,
					caseKind: observation.caseKind,
					caseConforms: observation.caseConforms,
					canonicalGatePassed: observation.canonicalGatePassed,
					proposalState: observation.memory.proposal.state,
					admissionState: observation.memory.admission.state,
					applicationState: observation.memory.application.state,
					retrievalState: observation.memory.retrieval.state,
					warmRunPassed: observation.stagePredicates.warm_run_passed,
					sameWorkItemInput: observation.stagePredicates.same_work_item_input,
					priorFailureRouteAvoided: observation.stagePredicates.prior_failure_route_avoided,
				}),
			),
		),
		metrics: projectMetrics(scorecard.metrics),
		issueCodes: Object.freeze([...scorecard.issueCodes]),
		resultRefs: Object.freeze(
			scorecard.resultRefs.map((ref) => Object.freeze({ kind: ref.kind, id: ref.id })),
		),
		provenance: projectProvenance(manifest),
	});
}
