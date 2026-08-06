import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const DEVELOPER_GUIDANCE_OBSERVATION_VERSION = "empirical-developer-guidance-observation.v1";
export const DEVELOPER_GUIDANCE_SCORECARD_VERSION = "empirical-developer-guidance-scorecard.v1";
export const DEVELOPER_GUIDANCE_CLAIM_BOUNDARY =
	"developer-guidance-utility-no-full-task-efficacy-claim";
export const DEVELOPER_GUIDANCE_MAX_OBSERVATION_BYTES = 262_144;

export type DeveloperGuidanceArm =
	| "relevant-applied"
	| "proposal-only"
	| "admission-rejected"
	| "irrelevant-applied"
	| "wrong-scope-applied";

export interface DeveloperGuidanceObservationV1 {
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
		readonly actionTraceDigest: string;
		readonly coordinateEvidenceDigest: string | null;
		readonly verifierEvidenceDigest: string | null;
		readonly memoryDelivered: boolean;
		readonly modelAttributedMemory: boolean;
		readonly validActionObserved: boolean;
		readonly workspaceMutationObserved: boolean;
		readonly verifierProgressObserved: boolean;
	};
}

export interface DeveloperGuidanceMatchedDifferenceV1 {
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

export interface DeveloperGuidanceScorecardV1 {
	readonly version: typeof DEVELOPER_GUIDANCE_SCORECARD_VERSION;
	readonly claimBoundary: typeof DEVELOPER_GUIDANCE_CLAIM_BOUNDARY;
	readonly efficacyClaim: "none";
	readonly observationCount: number;
	readonly evaluableObservationCount: number;
	readonly nonEvaluableObservationCount: number;
	readonly matchedPairCount: number;
	readonly matchedDifferences: readonly DeveloperGuidanceMatchedDifferenceV1[];
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

function optionalHorizonCount(value: number | null, max: number, field: string): void {
	if (value === null) return;
	if (!Number.isSafeInteger(value) || value < 1 || value > max) {
		throw new TypeError(`${field} must be null or a positive count within its frozen horizon`);
	}
}

function exactCoordinateCount(observation: DeveloperGuidanceObservationV1): number {
	return Object.values(observation.coordinates).filter((value) => value === true).length;
}

function optionalBoolean(value: unknown, field: string): boolean | null {
	if (value !== null && typeof value !== "boolean") {
		throw new TypeError(`${field} must be boolean or null`);
	}
	return value;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function validateDeveloperGuidanceObservation(
	value: DeveloperGuidanceObservationV1,
): DeveloperGuidanceObservationV1 {
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
	const horizon = record(value.horizon, "developerGuidance.horizon");
	exactKeys(horizon, ["maxActions", "maxRequests"], "developerGuidance.horizon");
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
			"actionTraceDigest",
			"coordinateEvidenceDigest",
			"memoryDelivered",
			"modelAttributedMemory",
			"validActionObserved",
			"verifierEvidenceDigest",
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
	for (const [field, evidenceValue] of Object.entries(value.evidence)) {
		if (field.endsWith("Digest")) continue;
		if (typeof evidenceValue !== "boolean") {
			throw new TypeError(`developerGuidance.evidence.${field} must be boolean`);
		}
	}
	digest(value.evidence.actionTraceDigest, "developerGuidance.evidence.actionTraceDigest");
	if (value.evidence.coordinateEvidenceDigest !== null) {
		digest(
			value.evidence.coordinateEvidenceDigest,
			"developerGuidance.evidence.coordinateEvidenceDigest",
		);
	}
	if (value.evidence.verifierEvidenceDigest !== null) {
		digest(
			value.evidence.verifierEvidenceDigest,
			"developerGuidance.evidence.verifierEvidenceDigest",
		);
	}
	boundedCount(value.horizon.maxRequests, "developerGuidance.horizon.maxRequests", 10_000);
	boundedCount(value.horizon.maxActions, "developerGuidance.horizon.maxActions", 10_000);
	if (value.horizon.maxRequests < 1 || value.horizon.maxActions < 1) {
		throw new TypeError("developer guidance horizons must be positive");
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
		(value.evidence.verifierProgressObserved || value.finalTaskVerifierPassed !== null) !==
		(value.evidence.verifierEvidenceDigest !== null)
	) {
		throw new TypeError("developer guidance verifier metrics lack bound evidence");
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

function matchedKey(observation: DeveloperGuidanceObservationV1): string {
	return `${observation.taskId}\u0000${observation.matchedBlockId}`;
}

function nullableDelta(relevant: number | null, proposalOnly: number | null): number | null {
	return relevant === null || proposalOnly === null ? null : relevant - proposalOnly;
}

export function aggregateDeveloperGuidanceScorecard(
	observations: readonly DeveloperGuidanceObservationV1[],
): DeveloperGuidanceScorecardV1 {
	if (observations.length < 1 || observations.length > 10_000) {
		throw new TypeError("developer guidance scorecard requires 1..10000 observations");
	}
	const frozen = observations
		.map(validateDeveloperGuidanceObservation)
		.sort((left, right) => compareText(left.observationId, right.observationId));
	if (new Set(frozen.map((item) => item.observationId)).size !== frozen.length) {
		throw new TypeError("developer guidance observationId must be unique");
	}
	const relevant = new Map<string, DeveloperGuidanceObservationV1>();
	const proposalOnly = new Map<string, DeveloperGuidanceObservationV1>();
	const comparisonCoordinates = new Map<
		string,
		{
			readonly digest: string;
			readonly maxRequests: number;
			readonly maxActions: number;
		}
	>();
	for (const observation of frozen) {
		const key = matchedKey(observation);
		const existingCoordinates = comparisonCoordinates.get(key);
		const currentCoordinates = {
			digest: observation.comparisonCoordinatesDigest,
			maxRequests: observation.horizon.maxRequests,
			maxActions: observation.horizon.maxActions,
		};
		if (
			existingCoordinates !== undefined &&
			(existingCoordinates.digest !== currentCoordinates.digest ||
				existingCoordinates.maxRequests !== currentCoordinates.maxRequests ||
				existingCoordinates.maxActions !== currentCoordinates.maxActions)
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
		if (target.has(key))
			throw new TypeError("developer guidance matched arm must be unique per task/block");
		target.set(key, observation);
	}
	const matchedDifferences: DeveloperGuidanceMatchedDifferenceV1[] = [];
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
