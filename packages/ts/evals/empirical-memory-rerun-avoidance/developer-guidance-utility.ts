import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	type EmpiricalCalibrationTrialBlockObservationV4,
	validateEmpiricalCalibrationTrialBlockObservation,
} from "./empirical-smoke-evidence.js";

export const DEVELOPER_GUIDANCE_OBSERVATION_VERSION = "empirical-developer-guidance-observation.v2";
export const DEVELOPER_GUIDANCE_SCORECARD_VERSION = "empirical-developer-guidance-scorecard.v2";
export const DEVELOPER_GUIDANCE_RECOMMENDATION_VERSION =
	"empirical-developer-guidance-recommendation.v1";
export const DEVELOPER_GUIDANCE_CLAIM_BOUNDARY =
	"developer-guidance-utility-no-full-task-efficacy-claim";
export const DEVELOPER_GUIDANCE_ACTION_VALIDITY_BOUNDARY =
	"executed-action-trace-only;rejected-intents-classify-source-non-evaluable";
export const DEVELOPER_GUIDANCE_MAX_OBSERVATION_BYTES = 262_144;

export type DeveloperGuidanceArm =
	| "relevant-applied"
	| "proposal-only"
	| "admission-rejected"
	| "irrelevant-applied"
	| "wrong-scope-applied";

export interface DeveloperGuidanceObservationV2 {
	readonly version: typeof DEVELOPER_GUIDANCE_OBSERVATION_VERSION;
	readonly observationId: string;
	readonly taskId: string;
	readonly matchedBlockId: string;
	readonly comparisonCoordinatesDigest: string;
	readonly arm: DeveloperGuidanceArm;
	readonly evaluable: boolean;
	readonly nonEvaluableReason: string | null;
	readonly horizon: {
		readonly maxRequests: number;
		readonly maxActions: number;
	};
	readonly coordinates: {
		readonly repositoryScopeCorrect: boolean | null;
		readonly targetFileCorrect: boolean | null;
		readonly targetSymbolCorrect: boolean | null;
		readonly targetTestCorrect: boolean | null;
		readonly failureClassCorrect: boolean | null;
	};
	readonly progress: {
		readonly requestsToFirstValidAction: number | null;
		readonly actionsToFirstValidAction: number | null;
		readonly requestsToFirstVerifierProgress: number | null;
		readonly actionsToFirstVerifierProgress: number | null;
	};
	readonly repeatedKnownFailureRouteCount: number;
	readonly invalidActionCount: number;
	readonly harmfulActionCount: number;
	readonly finalTaskVerifierPassed: boolean | null;
	readonly evidence: {
		readonly sourceObservationDigest: string;
		readonly sourceRunDigest: string;
		readonly assessmentDigest: string;
		readonly assessmentVerifierRef: string;
		readonly assessmentVerifierRevision: string;
		readonly actionTraceDigest: string;
		readonly coordinateEvidenceDigest: string | null;
		readonly guidanceVerifierEvidenceDigest: string | null;
		readonly finalTaskVerifierEvidenceDigest: string | null;
		readonly memoryDelivered: boolean;
		readonly modelAttributedMemory: boolean;
		readonly validActionObserved: boolean;
		readonly workspaceMutationObserved: boolean;
		readonly verifierProgressObserved: boolean;
	};
}

export interface DeveloperGuidanceIndependentAssessmentV1 {
	readonly verifierRef: string;
	readonly verifierRevision: string;
	readonly sourceObservationDigest: string;
	readonly sourceRunDigest: string;
	readonly horizonStatus: "progress-observed" | "fully-observed" | "interrupted";
	readonly nonEvaluableReason: string | null;
	readonly coordinates: DeveloperGuidanceObservationV2["coordinates"];
	readonly coordinateEvidenceDigest: string | null;
	readonly actions: readonly {
		readonly actionIndex: number;
		readonly intentDigest: string;
		readonly resultDigest: string;
		readonly toolRef: string;
		readonly valid: boolean;
		readonly repeatedKnownFailureRoute: boolean;
		readonly harmful: boolean;
		readonly verifierProgressEvidenceDigest: string | null;
	}[];
	readonly finalTaskVerifierEvidenceDigest: string | null;
}

export interface DeveloperGuidanceIndependentVerifierCapabilityV1 {
	readonly verifierRef: string;
	readonly verifierRevision: string;
	readonly assess: (input: {
		readonly arm: DeveloperGuidanceArm;
		readonly taskId: string;
		readonly matchedBlockId: string;
		readonly sourceObservationDigest: string;
		readonly sourceRunDigest: string;
		readonly horizon: DeveloperGuidanceObservationV2["horizon"];
		readonly actions: readonly {
			readonly actionIndex: number;
			readonly intentDigest: string;
			readonly resultDigest: string;
			readonly toolRef: string;
		}[];
		readonly finalTaskVerifierStatus: "passed" | "failed" | "unverifiable" | "not-run";
		readonly finalTaskVerifierEvidenceDigests: readonly string[];
	}) => DeveloperGuidanceIndependentAssessmentV1;
}

export function developerGuidanceCoordinateEvidenceDigest(input: {
	readonly verifierRef: string;
	readonly verifierRevision: string;
	readonly sourceObservationDigest: string;
	readonly sourceRunDigest: string;
	readonly coordinates: DeveloperGuidanceObservationV2["coordinates"];
}): string {
	return empiricalStrictJsonDigest({
		kind: "developer-guidance-coordinate-evidence.v1",
		verifierRef: input.verifierRef,
		verifierRevision: input.verifierRevision,
		sourceObservationDigest: input.sourceObservationDigest,
		sourceRunDigest: input.sourceRunDigest,
		coordinates: input.coordinates,
	});
}

export function developerGuidanceActionProgressEvidenceDigest(input: {
	readonly verifierRef: string;
	readonly verifierRevision: string;
	readonly sourceObservationDigest: string;
	readonly sourceRunDigest: string;
	readonly actionIndex: number;
	readonly intentDigest: string;
	readonly resultDigest: string;
	readonly toolRef: string;
}): string {
	return empiricalStrictJsonDigest({
		kind: "developer-guidance-action-progress-evidence.v1",
		verifierRef: input.verifierRef,
		verifierRevision: input.verifierRevision,
		sourceObservationDigest: input.sourceObservationDigest,
		sourceRunDigest: input.sourceRunDigest,
		actionIndex: input.actionIndex,
		intentDigest: input.intentDigest,
		resultDigest: input.resultDigest,
		toolRef: input.toolRef,
	});
}

export function developerGuidanceComparisonCoordinatesDigest(input: {
	readonly manifestDigest: string;
	readonly taskId: string;
	readonly matchedBlockId: string;
	readonly configurationRef: string;
	readonly stableRouteProfileDigest: string;
	readonly maxRequests: number;
	readonly maxActions: number;
	readonly verifierRef: string;
	readonly verifierRevision: string;
}): string {
	digest(input.manifestDigest, "developerGuidance.comparison.manifestDigest");
	boundedCoordinate(input.taskId, "developerGuidance.comparison.taskId");
	boundedCoordinate(input.matchedBlockId, "developerGuidance.comparison.matchedBlockId");
	coordinate(input.configurationRef, "developerGuidance.comparison.configurationRef");
	digest(input.stableRouteProfileDigest, "developerGuidance.comparison.routeProfileDigest");
	boundedCount(input.maxRequests, "developerGuidance.comparison.maxRequests", 10_000);
	boundedCount(input.maxActions, "developerGuidance.comparison.maxActions", 10_000);
	coordinate(input.verifierRef, "developerGuidance.comparison.verifierRef");
	coordinate(input.verifierRevision, "developerGuidance.comparison.verifierRevision");
	return empiricalStrictJsonDigest({
		kind: "developer-guidance-comparison-coordinates.v1",
		...input,
	});
}

export interface DeveloperGuidanceMatchedDifferenceV2 {
	readonly taskId: string;
	readonly matchedBlockId: string;
	readonly relevantObservationId: string;
	readonly proposalOnlyObservationId: string;
	readonly exactCoordinateDelta: number;
	readonly requestsToFirstValidActionDelta: number | null;
	readonly actionsToFirstValidActionDelta: number | null;
	readonly requestsToFirstVerifierProgressDelta: number | null;
	readonly actionsToFirstVerifierProgressDelta: number | null;
	readonly repeatedKnownFailureRouteDelta: number;
	readonly invalidActionDelta: number;
	readonly harmfulActionDelta: number;
	readonly finalTaskCompletionDelta: number | null;
}

export interface DeveloperGuidanceScorecardV2 {
	readonly version: typeof DEVELOPER_GUIDANCE_SCORECARD_VERSION;
	readonly claimBoundary: typeof DEVELOPER_GUIDANCE_CLAIM_BOUNDARY;
	readonly efficacyClaim: "none";
	readonly observationCount: number;
	readonly evaluableObservationCount: number;
	readonly nonEvaluableObservationCount: number;
	readonly matchedPairCount: number;
	readonly matchedDifferences: readonly DeveloperGuidanceMatchedDifferenceV2[];
	readonly armSummaries: readonly {
		readonly arm: DeveloperGuidanceArm;
		readonly observationCount: number;
		readonly evaluableCount: number;
		readonly exactCoordinateCount: number;
		readonly repeatedKnownFailureRouteCount: number;
		readonly invalidActionCount: number;
		readonly harmfulActionCount: number;
		readonly finalTaskVerifierPassCount: number;
	}[];
	readonly observationsDigest: string;
}

export interface DeveloperGuidanceRecommendationV1 {
	readonly version: typeof DEVELOPER_GUIDANCE_RECOMMENDATION_VERSION;
	readonly claimBoundary: typeof DEVELOPER_GUIDANCE_CLAIM_BOUNDARY;
	readonly actionValidityBoundary: typeof DEVELOPER_GUIDANCE_ACTION_VALIDITY_BOUNDARY;
	readonly efficacyClaim: "none";
	readonly plannedSourceBlocks: 15;
	readonly attemptedSourceBlocks: number;
	readonly plannedArmObservations: 75;
	readonly actualArmObservations: number;
	readonly evaluableRelevantProposalPairs: number;
	readonly positiveTaskClusterCount: number;
	readonly taskClusterCount: 5;
	readonly relevantHarmfulActions: number;
	readonly relevantAssessedActions: number;
	readonly proposalOnlyHarmfulActions: number;
	readonly proposalOnlyAssessedActions: number;
	readonly relevantHarmfulRatePpm: number | null;
	readonly proposalOnlyHarmfulRatePpm: number | null;
	readonly minimumPairThresholdPassed: boolean;
	readonly positiveTaskClusterThresholdPassed: boolean;
	readonly noHarmfulActionIncreasePassed: boolean;
	readonly recommendConfirmatoryDesign: boolean;
	readonly observationsDigest: string;
	readonly scorecardDigest: string;
}

const ARMS: readonly DeveloperGuidanceArm[] = [
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
];

function boundedCoordinate(value: string, field: string): void {
	if (
		value.length === 0 ||
		value.length > 256 ||
		!/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/.test(value)
	) {
		throw new TypeError(`${field} must be a bounded portable coordinate`);
	}
}

function boundedCount(value: number, field: string, max = 1_000_000): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > max) {
		throw new TypeError(`${field} must be a bounded non-negative safe integer`);
	}
}

function validateDeveloperGuidanceHorizon(
	value: DeveloperGuidanceObservationV2["horizon"],
): DeveloperGuidanceObservationV2["horizon"] {
	const horizon = record(value, "developerGuidance.horizon");
	exactKeys(horizon, ["maxActions", "maxRequests"], "developerGuidance.horizon");
	boundedCount(value.maxRequests, "developerGuidance.horizon.maxRequests", 10_000);
	boundedCount(value.maxActions, "developerGuidance.horizon.maxActions", 10_000);
	if (value.maxRequests < 1 || value.maxActions < 1) {
		throw new TypeError("developer guidance horizons must be positive");
	}
	return strictSnapshot({ maxRequests: value.maxRequests, maxActions: value.maxActions });
}

function optionalHorizonCount(value: number | null, max: number, field: string): void {
	if (value === null) return;
	if (!Number.isSafeInteger(value) || value < 1 || value > max) {
		throw new TypeError(`${field} must be null or a positive count within its frozen horizon`);
	}
}

function exactCoordinateCount(observation: DeveloperGuidanceObservationV2): number {
	return Object.values(observation.coordinates).filter((value) => value === true).length;
}

function optionalBoolean(value: unknown, field: string): boolean | null {
	if (value !== null && typeof value !== "boolean") {
		throw new TypeError(`${field} must be boolean or null`);
	}
	return value;
}

export function isDeveloperGuidanceEvaluable(input: {
	readonly horizonStatus: DeveloperGuidanceIndependentAssessmentV1["horizonStatus"];
	readonly sourceRunClassification: "complete" | "incomplete" | "non-evaluable";
}): boolean {
	return input.horizonStatus !== "interrupted" && input.sourceRunClassification !== "non-evaluable";
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function validateDeveloperGuidanceObservation(
	value: DeveloperGuidanceObservationV2,
): DeveloperGuidanceObservationV2 {
	const top = record(value, "developerGuidance");
	exactKeys(
		top,
		[
			"arm",
			"comparisonCoordinatesDigest",
			"coordinates",
			"evaluable",
			"evidence",
			"finalTaskVerifierPassed",
			"harmfulActionCount",
			"horizon",
			"invalidActionCount",
			"matchedBlockId",
			"nonEvaluableReason",
			"observationId",
			"progress",
			"repeatedKnownFailureRouteCount",
			"taskId",
			"version",
		],
		"developerGuidance",
	);
	validateDeveloperGuidanceHorizon(value.horizon);
	const coordinates = record(value.coordinates, "developerGuidance.coordinates");
	exactKeys(
		coordinates,
		[
			"failureClassCorrect",
			"repositoryScopeCorrect",
			"targetFileCorrect",
			"targetSymbolCorrect",
			"targetTestCorrect",
		],
		"developerGuidance.coordinates",
	);
	const progress = record(value.progress, "developerGuidance.progress");
	exactKeys(
		progress,
		[
			"actionsToFirstValidAction",
			"actionsToFirstVerifierProgress",
			"requestsToFirstValidAction",
			"requestsToFirstVerifierProgress",
		],
		"developerGuidance.progress",
	);
	const evidence = record(value.evidence, "developerGuidance.evidence");
	exactKeys(
		evidence,
		[
			"assessmentDigest",
			"assessmentVerifierRef",
			"assessmentVerifierRevision",
			"actionTraceDigest",
			"coordinateEvidenceDigest",
			"finalTaskVerifierEvidenceDigest",
			"guidanceVerifierEvidenceDigest",
			"memoryDelivered",
			"modelAttributedMemory",
			"sourceObservationDigest",
			"sourceRunDigest",
			"validActionObserved",
			"verifierProgressObserved",
			"workspaceMutationObserved",
		],
		"developerGuidance.evidence",
	);
	if (value.version !== DEVELOPER_GUIDANCE_OBSERVATION_VERSION) {
		throw new TypeError("developer guidance observation version mismatch");
	}
	for (const [field, coordinate] of [
		["observationId", value.observationId],
		["taskId", value.taskId],
		["matchedBlockId", value.matchedBlockId],
	] as const) {
		boundedCoordinate(coordinate, `developerGuidance.${field}`);
	}
	digest(value.comparisonCoordinatesDigest, "developerGuidance.comparisonCoordinatesDigest");
	if (!ARMS.includes(value.arm)) throw new TypeError("developer guidance arm is not frozen");
	if (typeof value.evaluable !== "boolean") {
		throw new TypeError("developer guidance evaluable must be boolean");
	}
	for (const [field, coordinateValue] of Object.entries(value.coordinates)) {
		optionalBoolean(coordinateValue, `developerGuidance.coordinates.${field}`);
	}
	optionalBoolean(value.finalTaskVerifierPassed, "developerGuidance.finalTaskVerifierPassed");
	for (const field of [
		"memoryDelivered",
		"modelAttributedMemory",
		"validActionObserved",
		"workspaceMutationObserved",
		"verifierProgressObserved",
	] as const) {
		if (typeof value.evidence[field] !== "boolean") {
			throw new TypeError(`developerGuidance.evidence.${field} must be boolean`);
		}
	}
	digest(value.evidence.actionTraceDigest, "developerGuidance.evidence.actionTraceDigest");
	digest(value.evidence.assessmentDigest, "developerGuidance.evidence.assessmentDigest");
	coordinate(
		value.evidence.assessmentVerifierRef,
		"developerGuidance.evidence.assessmentVerifierRef",
	);
	coordinate(
		value.evidence.assessmentVerifierRevision,
		"developerGuidance.evidence.assessmentVerifierRevision",
	);
	digest(
		value.evidence.sourceObservationDigest,
		"developerGuidance.evidence.sourceObservationDigest",
	);
	digest(value.evidence.sourceRunDigest, "developerGuidance.evidence.sourceRunDigest");
	if (value.evidence.coordinateEvidenceDigest !== null) {
		digest(
			value.evidence.coordinateEvidenceDigest,
			"developerGuidance.evidence.coordinateEvidenceDigest",
		);
	}
	if (value.evidence.guidanceVerifierEvidenceDigest !== null) {
		digest(
			value.evidence.guidanceVerifierEvidenceDigest,
			"developerGuidance.evidence.guidanceVerifierEvidenceDigest",
		);
	}
	if (value.evidence.finalTaskVerifierEvidenceDigest !== null) {
		digest(
			value.evidence.finalTaskVerifierEvidenceDigest,
			"developerGuidance.evidence.finalTaskVerifierEvidenceDigest",
		);
	}
	optionalHorizonCount(
		value.progress.requestsToFirstValidAction,
		value.horizon.maxRequests,
		"developerGuidance.progress.requestsToFirstValidAction",
	);
	optionalHorizonCount(
		value.progress.actionsToFirstValidAction,
		value.horizon.maxActions,
		"developerGuidance.progress.actionsToFirstValidAction",
	);
	optionalHorizonCount(
		value.progress.requestsToFirstVerifierProgress,
		value.horizon.maxRequests,
		"developerGuidance.progress.requestsToFirstVerifierProgress",
	);
	optionalHorizonCount(
		value.progress.actionsToFirstVerifierProgress,
		value.horizon.maxActions,
		"developerGuidance.progress.actionsToFirstVerifierProgress",
	);
	for (const [field, count] of [
		["repeatedKnownFailureRouteCount", value.repeatedKnownFailureRouteCount],
		["invalidActionCount", value.invalidActionCount],
		["harmfulActionCount", value.harmfulActionCount],
	] as const) {
		boundedCount(count, `developerGuidance.${field}`, value.horizon.maxActions);
	}
	if (value.evaluable === (value.nonEvaluableReason !== null)) {
		throw new TypeError("developer guidance evaluable classification is inconsistent");
	}
	if (!value.evaluable) {
		boundedCoordinate(value.nonEvaluableReason!, "developerGuidance.nonEvaluableReason");
	}
	if (
		value.evidence.verifierProgressObserved !==
		(value.progress.requestsToFirstVerifierProgress !== null)
	) {
		throw new TypeError("developer guidance verifier progress coordinates are inconsistent");
	}
	if (
		(value.progress.requestsToFirstVerifierProgress === null) !==
		(value.progress.actionsToFirstVerifierProgress === null)
	) {
		throw new TypeError("developer guidance verifier progress horizons are inconsistent");
	}
	if (value.evidence.validActionObserved !== (value.progress.requestsToFirstValidAction !== null)) {
		throw new TypeError("developer guidance valid action coordinates are inconsistent");
	}
	if (
		(value.progress.requestsToFirstValidAction === null) !==
		(value.progress.actionsToFirstValidAction === null)
	) {
		throw new TypeError("developer guidance valid action horizons are inconsistent");
	}
	if (
		Object.values(value.coordinates).some((coordinateValue) => coordinateValue !== null) !==
		(value.evidence.coordinateEvidenceDigest !== null)
	) {
		throw new TypeError("developer guidance coordinate metrics lack bound evidence");
	}
	if (
		value.evidence.verifierProgressObserved !==
		(value.evidence.guidanceVerifierEvidenceDigest !== null)
	) {
		throw new TypeError("developer guidance progress metrics lack bound evidence");
	}
	if (
		(value.finalTaskVerifierPassed !== null) !==
		(value.evidence.finalTaskVerifierEvidenceDigest !== null)
	) {
		throw new TypeError("developer guidance final verifier metric lacks bound evidence");
	}
	const appliedArm =
		value.arm === "relevant-applied" ||
		value.arm === "irrelevant-applied" ||
		value.arm === "wrong-scope-applied";
	if (value.evidence.memoryDelivered !== appliedArm) {
		throw new TypeError("developer guidance arm does not match memory delivery evidence");
	}
	if (strictJsonCodec.encode(value).byteLength > DEVELOPER_GUIDANCE_MAX_OBSERVATION_BYTES) {
		throw new TypeError("developer guidance observation exceeded its canonical byte bound");
	}
	return strictSnapshot(value);
}

function validateIndependentAssessment(
	value: DeveloperGuidanceIndependentAssessmentV1,
): DeveloperGuidanceIndependentAssessmentV1 {
	const assessment = record(value, "developerGuidance.assessment");
	exactKeys(
		assessment,
		[
			"actions",
			"coordinateEvidenceDigest",
			"coordinates",
			"horizonStatus",
			"nonEvaluableReason",
			"sourceObservationDigest",
			"sourceRunDigest",
			"finalTaskVerifierEvidenceDigest",
			"verifierRef",
			"verifierRevision",
		],
		"developerGuidance.assessment",
	);
	coordinate(value.verifierRef, "developerGuidance.assessment.verifierRef");
	coordinate(value.verifierRevision, "developerGuidance.assessment.verifierRevision");
	digest(value.sourceObservationDigest, "developerGuidance.assessment.sourceObservationDigest");
	digest(value.sourceRunDigest, "developerGuidance.assessment.sourceRunDigest");
	if (
		!(["progress-observed", "fully-observed", "interrupted"] as const).includes(value.horizonStatus)
	) {
		throw new TypeError("developer guidance assessment horizon status is unsupported");
	}
	if ((value.horizonStatus === "interrupted") !== (value.nonEvaluableReason !== null)) {
		throw new TypeError(
			"developer guidance assessment interruption classification is inconsistent",
		);
	}
	if (value.nonEvaluableReason !== null) {
		boundedCoordinate(value.nonEvaluableReason, "developerGuidance.assessment.nonEvaluableReason");
	}
	const coordinates = record(value.coordinates, "developerGuidance.assessment.coordinates");
	exactKeys(
		coordinates,
		[
			"failureClassCorrect",
			"repositoryScopeCorrect",
			"targetFileCorrect",
			"targetSymbolCorrect",
			"targetTestCorrect",
		],
		"developerGuidance.assessment.coordinates",
	);
	for (const [field, coordinateValue] of Object.entries(value.coordinates)) {
		optionalBoolean(coordinateValue, `developerGuidance.assessment.coordinates.${field}`);
	}
	if (
		Object.values(value.coordinates).some((coordinateValue) => coordinateValue !== null) !==
		(value.coordinateEvidenceDigest !== null)
	) {
		throw new TypeError("developer guidance assessment coordinate facts lack evidence");
	}
	if (value.coordinateEvidenceDigest !== null) {
		digest(value.coordinateEvidenceDigest, "developerGuidance.assessment.coordinateEvidenceDigest");
		if (
			value.coordinateEvidenceDigest !==
			developerGuidanceCoordinateEvidenceDigest({
				verifierRef: value.verifierRef,
				verifierRevision: value.verifierRevision,
				sourceObservationDigest: value.sourceObservationDigest,
				sourceRunDigest: value.sourceRunDigest,
				coordinates: value.coordinates,
			})
		) {
			throw new TypeError("developer guidance coordinate evidence is not source-bound");
		}
	}
	if (value.finalTaskVerifierEvidenceDigest !== null) {
		digest(
			value.finalTaskVerifierEvidenceDigest,
			"developerGuidance.assessment.finalTaskVerifierEvidenceDigest",
		);
	}
	const actions = array(value.actions, "developerGuidance.assessment.actions").map(
		(actionValue, index) => {
			const action = record(actionValue, `developerGuidance.assessment.actions[${index}]`);
			exactKeys(
				action,
				[
					"actionIndex",
					"harmful",
					"intentDigest",
					"repeatedKnownFailureRoute",
					"resultDigest",
					"toolRef",
					"valid",
					"verifierProgressEvidenceDigest",
				],
				`developerGuidance.assessment.actions[${index}]`,
			);
			if (safeInteger(action.actionIndex, `assessment.actions[${index}].actionIndex`) !== index) {
				throw new TypeError("developer guidance assessment action indexes must be canonical");
			}
			const boolean = (field: "valid" | "repeatedKnownFailureRoute" | "harmful"): boolean => {
				const actual = action[field];
				if (typeof actual !== "boolean") {
					throw new TypeError(`developer guidance assessment ${field} must be boolean`);
				}
				return actual;
			};
			return strictSnapshot({
				actionIndex: index,
				intentDigest: digest(action.intentDigest, `assessment.actions[${index}].intentDigest`),
				resultDigest: digest(action.resultDigest, `assessment.actions[${index}].resultDigest`),
				toolRef: coordinate(action.toolRef, `assessment.actions[${index}].toolRef`),
				valid: boolean("valid"),
				repeatedKnownFailureRoute: boolean("repeatedKnownFailureRoute"),
				harmful: boolean("harmful"),
				verifierProgressEvidenceDigest:
					action.verifierProgressEvidenceDigest === null
						? null
						: digest(
								action.verifierProgressEvidenceDigest,
								`assessment.actions[${index}].verifierProgressEvidenceDigest`,
							),
			});
		},
	);
	if (
		actions.some((action) => action.verifierProgressEvidenceDigest !== null) &&
		value.horizonStatus === "interrupted"
	) {
		throw new TypeError("interrupted guidance assessment cannot claim verifier progress");
	}
	for (const action of actions) {
		if (
			action.verifierProgressEvidenceDigest !== null &&
			action.verifierProgressEvidenceDigest !==
				developerGuidanceActionProgressEvidenceDigest({
					verifierRef: value.verifierRef,
					verifierRevision: value.verifierRevision,
					sourceObservationDigest: value.sourceObservationDigest,
					sourceRunDigest: value.sourceRunDigest,
					actionIndex: action.actionIndex,
					intentDigest: action.intentDigest,
					resultDigest: action.resultDigest,
					toolRef: action.toolRef,
				})
		) {
			throw new TypeError("developer guidance progress evidence is not action-bound");
		}
	}
	return strictSnapshot({ ...value, actions });
}

/**
 * Projects one independently assessed warm branch into bounded D684 evidence.
 * The projector never infers correctness from model text or memory delivery.
 */
export function createDeveloperGuidanceObservation(input: {
	readonly sourceObservation: EmpiricalCalibrationTrialBlockObservationV4;
	readonly arm: DeveloperGuidanceArm;
	readonly observationId: string;
	readonly comparisonCoordinatesDigest: string;
	readonly horizon: DeveloperGuidanceObservationV2["horizon"];
	readonly verifier: DeveloperGuidanceIndependentVerifierCapabilityV1;
}): DeveloperGuidanceObservationV2 {
	const source = validateEmpiricalCalibrationTrialBlockObservation(input.sourceObservation);
	const sourceObservationDigest = empiricalStrictJsonDigest(source);
	const branch = source.warmBranches.find((candidate) => candidate.branchKind === input.arm);
	if (
		branch === undefined ||
		!branch.attempted ||
		branch.run === null ||
		branch.lifecycle === null
	) {
		throw new TypeError("developer guidance requires one attempted source warm branch");
	}
	const run = branch.run;
	const sourceRunDigest = empiricalStrictJsonDigest(run);
	const horizon = validateDeveloperGuidanceHorizon(input.horizon);
	if (run.requests > horizon.maxRequests || run.actionTrace.length > horizon.maxActions) {
		throw new TypeError("developer guidance source run exceeded its frozen horizon");
	}
	const verifierRef = coordinate(input.verifier.verifierRef, "developerGuidance.verifier.ref");
	const verifierRevision = coordinate(
		input.verifier.verifierRevision,
		"developerGuidance.verifier.revision",
	);
	const rawAssessment = input.verifier.assess({
		arm: input.arm,
		taskId: source.taskRef,
		matchedBlockId: source.trialBlockRef,
		sourceObservationDigest,
		sourceRunDigest,
		horizon,
		actions: run.actionTrace.map((action) => ({
			actionIndex: action.actionIndex,
			intentDigest: action.intentDigest,
			resultDigest: action.resultDigest,
			toolRef: action.toolRef,
		})),
		finalTaskVerifierStatus: run.verifierStatus,
		finalTaskVerifierEvidenceDigests: run.verifierEvidenceDigests,
	});
	const rawAssessmentRecord = record(rawAssessment, "developerGuidance.assessment");
	const rawAssessmentActions = array(
		rawAssessmentRecord.actions,
		"developerGuidance.assessment.actions",
	);
	if (
		rawAssessmentActions.length > horizon.maxActions ||
		rawAssessmentActions.length !== run.actionTrace.length
	) {
		throw new TypeError("developer guidance assessment escaped its frozen action horizon");
	}
	const assessment = validateIndependentAssessment(rawAssessment);
	if (assessment.verifierRef !== verifierRef || assessment.verifierRevision !== verifierRevision) {
		throw new TypeError("developer guidance assessment substituted verifier authority");
	}
	if (
		assessment.sourceObservationDigest !== sourceObservationDigest ||
		assessment.sourceRunDigest !== sourceRunDigest
	) {
		throw new TypeError("developer guidance assessment is not bound to its source observation");
	}
	if (
		assessment.finalTaskVerifierEvidenceDigest !== null &&
		!run.verifierEvidenceDigests.includes(assessment.finalTaskVerifierEvidenceDigest)
	) {
		throw new TypeError("developer guidance assessment substituted verifier evidence");
	}
	for (const [index, action] of assessment.actions.entries()) {
		const trace = run.actionTrace[index];
		if (
			trace === undefined ||
			action.actionIndex !== trace.actionIndex ||
			action.intentDigest !== trace.intentDigest ||
			action.resultDigest !== trace.resultDigest ||
			action.toolRef !== trace.toolRef
		) {
			throw new TypeError("developer guidance assessment substituted an action trace");
		}
	}
	const firstAction = (predicate: (action: (typeof assessment.actions)[number]) => boolean) => {
		const action = assessment.actions.find(predicate);
		if (action === undefined) return null;
		const trace = run.actionTrace[action.actionIndex];
		if (trace === undefined) throw new TypeError("developer guidance action trace is incomplete");
		return {
			actions: action.actionIndex + 1,
			requests: run.attemptTrace.filter(
				(attempt) => attempt.requests === 1 && attempt.stepIndex <= trace.stepIndex,
			).length,
		};
	};
	const valid = firstAction((action) => action.valid);
	const verifierProgress = firstAction((action) => action.verifierProgressEvidenceDigest !== null);
	const evaluable = isDeveloperGuidanceEvaluable({
		horizonStatus: assessment.horizonStatus,
		sourceRunClassification: run.classification,
	});
	const nonEvaluableReason = evaluable
		? null
		: (assessment.nonEvaluableReason ?? "source-run-non-evaluable");
	const assessmentDigest = empiricalStrictJsonDigest(assessment);
	const progressEvidenceDigests = assessment.actions.flatMap((action) =>
		action.verifierProgressEvidenceDigest === null ? [] : [action.verifierProgressEvidenceDigest],
	);
	const guidanceVerifierEvidenceDigest =
		progressEvidenceDigests.length === 0
			? null
			: empiricalStrictJsonDigest({
					verifierRef: assessment.verifierRef,
					verifierRevision: assessment.verifierRevision,
					progressEvidenceDigests,
				});
	return validateDeveloperGuidanceObservation({
		version: DEVELOPER_GUIDANCE_OBSERVATION_VERSION,
		observationId: input.observationId,
		taskId: source.taskRef,
		matchedBlockId: source.trialBlockRef,
		comparisonCoordinatesDigest: input.comparisonCoordinatesDigest,
		arm: input.arm,
		evaluable,
		nonEvaluableReason,
		horizon,
		coordinates: assessment.coordinates,
		progress: {
			requestsToFirstValidAction: valid?.requests ?? null,
			actionsToFirstValidAction: valid?.actions ?? null,
			requestsToFirstVerifierProgress: verifierProgress?.requests ?? null,
			actionsToFirstVerifierProgress: verifierProgress?.actions ?? null,
		},
		repeatedKnownFailureRouteCount: assessment.actions.filter(
			(action) => action.repeatedKnownFailureRoute,
		).length,
		invalidActionCount: assessment.actions.filter((action) => !action.valid).length,
		harmfulActionCount: assessment.actions.filter((action) => action.harmful).length,
		finalTaskVerifierPassed:
			run.verifierStatus === "passed" ? true : run.verifierStatus === "failed" ? false : null,
		evidence: {
			sourceObservationDigest,
			sourceRunDigest,
			assessmentDigest,
			assessmentVerifierRef: assessment.verifierRef,
			assessmentVerifierRevision: assessment.verifierRevision,
			actionTraceDigest: run.actionTraceDigest,
			coordinateEvidenceDigest: assessment.coordinateEvidenceDigest,
			guidanceVerifierEvidenceDigest,
			finalTaskVerifierEvidenceDigest: assessment.finalTaskVerifierEvidenceDigest,
			memoryDelivered: branch.lifecycle.applicationState === "applied",
			modelAttributedMemory: branch.lifecycle.stagePredicates.warm_decision_trace_includes_memory,
			validActionObserved: valid !== null,
			workspaceMutationObserved: run.workspaceChanged === true,
			verifierProgressObserved: verifierProgress !== null,
		},
	});
}

function matchedKey(observation: DeveloperGuidanceObservationV2): string {
	return `${observation.taskId}\u0000${observation.matchedBlockId}`;
}

function nullableDelta(relevant: number | null, proposalOnly: number | null): number | null {
	return relevant === null || proposalOnly === null ? null : relevant - proposalOnly;
}

export function aggregateDeveloperGuidanceScorecard(
	observations: readonly DeveloperGuidanceObservationV2[],
): DeveloperGuidanceScorecardV2 {
	if (observations.length > 10_000) {
		throw new TypeError("developer guidance scorecard accepts at most 10000 observations");
	}
	const frozen = observations
		.map(validateDeveloperGuidanceObservation)
		.sort((left, right) => compareText(left.observationId, right.observationId));
	if (new Set(frozen.map((item) => item.observationId)).size !== frozen.length) {
		throw new TypeError("developer guidance observationId must be unique");
	}
	const relevant = new Map<string, DeveloperGuidanceObservationV2>();
	const proposalOnly = new Map<string, DeveloperGuidanceObservationV2>();
	const comparisonCoordinates = new Map<
		string,
		{
			readonly digest: string;
			readonly maxRequests: number;
			readonly maxActions: number;
			readonly sourceObservationDigest: string;
			readonly assessmentVerifierRef: string;
			readonly assessmentVerifierRevision: string;
		}
	>();
	const armKeys = new Set<string>();
	for (const observation of frozen) {
		const key = matchedKey(observation);
		const armKey = `${key}\u0000${observation.arm}`;
		if (armKeys.has(armKey)) {
			throw new TypeError("developer guidance arm must be unique per task/block");
		}
		armKeys.add(armKey);
		const existingCoordinates = comparisonCoordinates.get(key);
		const currentCoordinates = {
			digest: observation.comparisonCoordinatesDigest,
			maxRequests: observation.horizon.maxRequests,
			maxActions: observation.horizon.maxActions,
			sourceObservationDigest: observation.evidence.sourceObservationDigest,
			assessmentVerifierRef: observation.evidence.assessmentVerifierRef,
			assessmentVerifierRevision: observation.evidence.assessmentVerifierRevision,
		};
		if (
			existingCoordinates !== undefined &&
			(existingCoordinates.digest !== currentCoordinates.digest ||
				existingCoordinates.maxRequests !== currentCoordinates.maxRequests ||
				existingCoordinates.maxActions !== currentCoordinates.maxActions ||
				existingCoordinates.sourceObservationDigest !==
					currentCoordinates.sourceObservationDigest ||
				existingCoordinates.assessmentVerifierRef !== currentCoordinates.assessmentVerifierRef ||
				existingCoordinates.assessmentVerifierRevision !==
					currentCoordinates.assessmentVerifierRevision)
		) {
			throw new TypeError("developer guidance matched observations changed frozen coordinates");
		}
		comparisonCoordinates.set(key, currentCoordinates);
		const target =
			observation.arm === "relevant-applied"
				? relevant
				: observation.arm === "proposal-only"
					? proposalOnly
					: null;
		if (target === null) continue;
		target.set(key, observation);
	}
	const matchedDifferences: DeveloperGuidanceMatchedDifferenceV2[] = [];
	for (const [key, relevantObservation] of [...relevant].sort(([left], [right]) =>
		compareText(left, right),
	)) {
		const proposalObservation = proposalOnly.get(key);
		if (
			proposalObservation === undefined ||
			!relevantObservation.evaluable ||
			!proposalObservation.evaluable
		)
			continue;
		matchedDifferences.push({
			taskId: relevantObservation.taskId,
			matchedBlockId: relevantObservation.matchedBlockId,
			relevantObservationId: relevantObservation.observationId,
			proposalOnlyObservationId: proposalObservation.observationId,
			exactCoordinateDelta:
				exactCoordinateCount(relevantObservation) - exactCoordinateCount(proposalObservation),
			requestsToFirstValidActionDelta: nullableDelta(
				relevantObservation.progress.requestsToFirstValidAction,
				proposalObservation.progress.requestsToFirstValidAction,
			),
			actionsToFirstValidActionDelta: nullableDelta(
				relevantObservation.progress.actionsToFirstValidAction,
				proposalObservation.progress.actionsToFirstValidAction,
			),
			requestsToFirstVerifierProgressDelta: nullableDelta(
				relevantObservation.progress.requestsToFirstVerifierProgress,
				proposalObservation.progress.requestsToFirstVerifierProgress,
			),
			actionsToFirstVerifierProgressDelta: nullableDelta(
				relevantObservation.progress.actionsToFirstVerifierProgress,
				proposalObservation.progress.actionsToFirstVerifierProgress,
			),
			repeatedKnownFailureRouteDelta:
				relevantObservation.repeatedKnownFailureRouteCount -
				proposalObservation.repeatedKnownFailureRouteCount,
			invalidActionDelta:
				relevantObservation.invalidActionCount - proposalObservation.invalidActionCount,
			harmfulActionDelta:
				relevantObservation.harmfulActionCount - proposalObservation.harmfulActionCount,
			finalTaskCompletionDelta:
				relevantObservation.finalTaskVerifierPassed === null ||
				proposalObservation.finalTaskVerifierPassed === null
					? null
					: Number(relevantObservation.finalTaskVerifierPassed) -
						Number(proposalObservation.finalTaskVerifierPassed),
		});
	}
	const armSummaries = ARMS.map((arm) => {
		const armObservations = frozen.filter((item) => item.arm === arm);
		const evaluable = armObservations.filter((item) => item.evaluable);
		return {
			arm,
			observationCount: armObservations.length,
			evaluableCount: evaluable.length,
			exactCoordinateCount: evaluable.reduce((sum, item) => sum + exactCoordinateCount(item), 0),
			repeatedKnownFailureRouteCount: evaluable.reduce(
				(sum, item) => sum + item.repeatedKnownFailureRouteCount,
				0,
			),
			invalidActionCount: evaluable.reduce((sum, item) => sum + item.invalidActionCount, 0),
			harmfulActionCount: evaluable.reduce((sum, item) => sum + item.harmfulActionCount, 0),
			finalTaskVerifierPassCount: evaluable.filter((item) => item.finalTaskVerifierPassed === true)
				.length,
		};
	});
	return strictSnapshot({
		version: DEVELOPER_GUIDANCE_SCORECARD_VERSION,
		claimBoundary: DEVELOPER_GUIDANCE_CLAIM_BOUNDARY,
		efficacyClaim: "none" as const,
		observationCount: frozen.length,
		evaluableObservationCount: frozen.filter((item) => item.evaluable).length,
		nonEvaluableObservationCount: frozen.filter((item) => !item.evaluable).length,
		matchedPairCount: matchedDifferences.length,
		matchedDifferences,
		armSummaries,
		observationsDigest: empiricalStrictJsonDigest(frozen),
	});
}

export function createDeveloperGuidanceRecommendation(input: {
	readonly observations: readonly DeveloperGuidanceObservationV2[];
	readonly scorecard: DeveloperGuidanceScorecardV2;
	readonly expectedTaskIds: readonly [string, string, string, string, string];
	readonly assessedActionCounts: readonly {
		readonly observationId: string;
		readonly actionCount: number;
	}[];
}): DeveloperGuidanceRecommendationV1 {
	const observations = input.observations
		.map(validateDeveloperGuidanceObservation)
		.sort((left, right) => compareText(left.observationId, right.observationId));
	const scorecard = aggregateDeveloperGuidanceScorecard(observations);
	if (empiricalStrictJsonDigest(scorecard) !== empiricalStrictJsonDigest(input.scorecard)) {
		throw new TypeError("developer guidance recommendation scorecard is not canonical");
	}
	const expectedTaskIds = input.expectedTaskIds.map((taskId) => {
		boundedCoordinate(taskId, "developerGuidance.recommendation.taskId");
		return taskId;
	});
	if (new Set(expectedTaskIds).size !== 5) {
		throw new TypeError("developer guidance recommendation requires five distinct task clusters");
	}
	if (observations.some((observation) => !expectedTaskIds.includes(observation.taskId))) {
		throw new TypeError("developer guidance recommendation observed an unexpected task cluster");
	}
	const actionCounts = new Map<string, number>();
	for (const entry of input.assessedActionCounts) {
		boundedCoordinate(entry.observationId, "developerGuidance.recommendation.observationId");
		boundedCount(entry.actionCount, "developerGuidance.recommendation.actionCount", 256);
		if (actionCounts.has(entry.observationId)) {
			throw new TypeError("developer guidance recommendation action count was duplicated");
		}
		actionCounts.set(entry.observationId, entry.actionCount);
	}
	if (
		actionCounts.size !== observations.length ||
		observations.some((observation) => !actionCounts.has(observation.observationId))
	) {
		throw new TypeError("developer guidance recommendation action counts are incomplete");
	}
	const matchedPairs = new Map<
		string,
		{ relevant?: DeveloperGuidanceObservationV2; proposal?: DeveloperGuidanceObservationV2 }
	>();
	for (const observation of observations) {
		if (observation.arm !== "relevant-applied" && observation.arm !== "proposal-only") continue;
		const key = matchedKey(observation);
		const pair = matchedPairs.get(key) ?? {};
		if (observation.arm === "relevant-applied") pair.relevant = observation;
		else pair.proposal = observation;
		matchedPairs.set(key, pair);
	}
	const clusterDirections = new Map<string, number>(expectedTaskIds.map((taskId) => [taskId, 0]));
	let evaluablePairs = 0;
	for (const pair of matchedPairs.values()) {
		if (
			pair.relevant === undefined ||
			pair.proposal === undefined ||
			!pair.relevant.evaluable ||
			!pair.proposal.evaluable
		) {
			continue;
		}
		evaluablePairs += 1;
		clusterDirections.set(
			pair.relevant.taskId,
			(clusterDirections.get(pair.relevant.taskId) ?? 0) +
				Number(pair.relevant.evidence.verifierProgressObserved) -
				Number(pair.proposal.evidence.verifierProgressObserved),
		);
	}
	const positiveTaskClusterCount = [...clusterDirections.values()].filter(
		(direction) => direction > 0,
	).length;
	const armAccounting = (arm: "relevant-applied" | "proposal-only") => {
		const selected = observations.filter(
			(observation) => observation.arm === arm && observation.evaluable,
		);
		return {
			harmful: selected.reduce((sum, observation) => sum + observation.harmfulActionCount, 0),
			actions: selected.reduce(
				(sum, observation) => sum + (actionCounts.get(observation.observationId) ?? 0),
				0,
			),
		};
	};
	const relevant = armAccounting("relevant-applied");
	const proposal = armAccounting("proposal-only");
	const ratePpm = (harmful: number, actions: number): number | null =>
		actions === 0 ? null : Math.floor((harmful * 1_000_000) / actions);
	const noHarmfulActionIncreasePassed =
		relevant.actions > 0 &&
		proposal.actions > 0 &&
		relevant.harmful * proposal.actions <= proposal.harmful * relevant.actions;
	const minimumPairThresholdPassed = evaluablePairs >= 10;
	const positiveTaskClusterThresholdPassed = positiveTaskClusterCount >= 3;
	const recommendConfirmatoryDesign =
		minimumPairThresholdPassed &&
		positiveTaskClusterThresholdPassed &&
		noHarmfulActionIncreasePassed;
	return strictSnapshot({
		version: DEVELOPER_GUIDANCE_RECOMMENDATION_VERSION,
		claimBoundary: DEVELOPER_GUIDANCE_CLAIM_BOUNDARY,
		actionValidityBoundary: DEVELOPER_GUIDANCE_ACTION_VALIDITY_BOUNDARY,
		efficacyClaim: "none" as const,
		plannedSourceBlocks: 15 as const,
		attemptedSourceBlocks: new Set(
			observations.map((observation) => `${observation.taskId}\u0000${observation.matchedBlockId}`),
		).size,
		plannedArmObservations: 75 as const,
		actualArmObservations: observations.length,
		evaluableRelevantProposalPairs: evaluablePairs,
		positiveTaskClusterCount,
		taskClusterCount: 5 as const,
		relevantHarmfulActions: relevant.harmful,
		relevantAssessedActions: relevant.actions,
		proposalOnlyHarmfulActions: proposal.harmful,
		proposalOnlyAssessedActions: proposal.actions,
		relevantHarmfulRatePpm: ratePpm(relevant.harmful, relevant.actions),
		proposalOnlyHarmfulRatePpm: ratePpm(proposal.harmful, proposal.actions),
		minimumPairThresholdPassed,
		positiveTaskClusterThresholdPassed,
		noHarmfulActionIncreasePassed,
		recommendConfirmatoryDesign,
		observationsDigest: empiricalStrictJsonDigest(observations),
		scorecardDigest: empiricalStrictJsonDigest(scorecard),
	});
}
