import { describe, expect, it } from "vitest";
import {
	aggregateDeveloperGuidanceScorecard,
	DEVELOPER_GUIDANCE_CLAIM_BOUNDARY,
	DEVELOPER_GUIDANCE_OBSERVATION_VERSION,
	DEVELOPER_GUIDANCE_SCORECARD_VERSION,
	type DeveloperGuidanceArm,
	type DeveloperGuidanceObservationV2,
	isDeveloperGuidanceEvaluable,
} from "../../evals/empirical-memory-rerun-avoidance/developer-guidance-utility.js";

function observation(input: {
	readonly id: string;
	readonly arm: DeveloperGuidanceArm;
	readonly block?: string;
	readonly evaluable?: boolean;
	readonly exact?: boolean;
	readonly validRequest?: number | null;
	readonly progressRequest?: number | null;
	readonly repeated?: number;
	readonly invalid?: number;
	readonly harmful?: number;
	readonly final?: boolean | null;
}): DeveloperGuidanceObservationV2 {
	const evaluable = input.evaluable ?? true;
	const validRequest = input.validRequest === undefined ? 1 : input.validRequest;
	const progressRequest = input.progressRequest === undefined ? 2 : input.progressRequest;
	return {
		version: DEVELOPER_GUIDANCE_OBSERVATION_VERSION,
		observationId: input.id,
		taskId: "task-guidance",
		matchedBlockId: input.block ?? "block-1",
		comparisonCoordinatesDigest: `sha256:${"a".repeat(64)}`,
		arm: input.arm,
		evaluable,
		nonEvaluableReason: evaluable ? null : "provider-timeout",
		horizon: { maxRequests: 8, maxActions: 16 },
		coordinates: {
			repositoryScopeCorrect: input.exact ?? true,
			targetFileCorrect: input.exact ?? true,
			targetSymbolCorrect: input.exact ?? true,
			targetTestCorrect: input.exact ?? true,
			failureClassCorrect: input.exact ?? true,
		},
		progress: {
			requestsToFirstValidAction: validRequest,
			actionsToFirstValidAction: validRequest,
			requestsToFirstVerifierProgress: progressRequest,
			actionsToFirstVerifierProgress: progressRequest,
		},
		repeatedKnownFailureRouteCount: input.repeated ?? 0,
		invalidActionCount: input.invalid ?? 0,
		harmfulActionCount: input.harmful ?? 0,
		finalTaskVerifierPassed: input.final ?? null,
		evidence: {
			sourceObservationDigest: `sha256:${"f".repeat(64)}`,
			sourceRunDigest: `sha256:${"b".repeat(64)}`,
			assessmentDigest: `sha256:${"1".repeat(64)}`,
			assessmentVerifierRef: "guidance-verifier",
			assessmentVerifierRevision: "guidance-verifier.v1",
			actionTraceDigest: `sha256:${"c".repeat(64)}`,
			coordinateEvidenceDigest: `sha256:${"d".repeat(64)}`,
			guidanceVerifierEvidenceDigest: progressRequest !== null ? `sha256:${"e".repeat(64)}` : null,
			finalTaskVerifierEvidenceDigest:
				(input.final ?? null) !== null ? `sha256:${"8".repeat(64)}` : null,
			memoryDelivered: input.arm.endsWith("applied"),
			modelAttributedMemory: false,
			validActionObserved: validRequest !== null,
			workspaceMutationObserved: progressRequest !== null,
			verifierProgressObserved: progressRequest !== null,
		},
	};
}

describe("D684 package-private developer guidance utility", () => {
	it("never launders a non-evaluable source run into guidance evidence", () => {
		expect(
			isDeveloperGuidanceEvaluable({
				horizonStatus: "progress-observed",
				sourceRunClassification: "non-evaluable",
			}),
		).toBe(false);
		expect(
			isDeveloperGuidanceEvaluable({
				horizonStatus: "fully-observed",
				sourceRunClassification: "incomplete",
			}),
		).toBe(true);
	});
	it("aggregates only evaluable relevant/proposal matched pairs into differences", () => {
		const scorecard = aggregateDeveloperGuidanceScorecard([
			observation({
				id: "relevant-1",
				arm: "relevant-applied",
				validRequest: 1,
				progressRequest: 2,
			}),
			observation({
				id: "proposal-1",
				arm: "proposal-only",
				exact: false,
				validRequest: 3,
				progressRequest: 5,
				repeated: 1,
				invalid: 2,
			}),
			observation({ id: "irrelevant-1", arm: "irrelevant-applied", harmful: 1 }),
			observation({
				id: "relevant-2",
				arm: "relevant-applied",
				block: "block-2",
				evaluable: false,
			}),
			observation({ id: "proposal-2", arm: "proposal-only", block: "block-2" }),
		]);

		expect(scorecard).toMatchObject({
			version: DEVELOPER_GUIDANCE_SCORECARD_VERSION,
			claimBoundary: DEVELOPER_GUIDANCE_CLAIM_BOUNDARY,
			efficacyClaim: "none",
			observationCount: 5,
			evaluableObservationCount: 4,
			nonEvaluableObservationCount: 1,
			matchedPairCount: 1,
		});
		expect(scorecard.matchedDifferences).toEqual([
			expect.objectContaining({
				exactCoordinateDelta: 5,
				requestsToFirstValidActionDelta: -2,
				actionsToFirstValidActionDelta: -2,
				requestsToFirstVerifierProgressDelta: -3,
				actionsToFirstVerifierProgressDelta: -3,
				repeatedKnownFailureRouteDelta: -1,
				invalidActionDelta: -2,
				harmfulActionDelta: 0,
			}),
		]);
	});

	it("is independent of input order and keeps negative controls descriptive", () => {
		const observations = [
			observation({ id: "relevant", arm: "relevant-applied" }),
			observation({ id: "proposal", arm: "proposal-only" }),
			observation({ id: "wrong", arm: "wrong-scope-applied", invalid: 2, harmful: 1 }),
			observation({
				id: "rejected",
				arm: "admission-rejected",
				validRequest: null,
				progressRequest: null,
			}),
		];

		const forward = aggregateDeveloperGuidanceScorecard(observations);
		const reverse = aggregateDeveloperGuidanceScorecard([...observations].reverse());

		expect(reverse).toEqual(forward);
		expect(forward.observationsDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(
			forward.armSummaries.find((summary) => summary.arm === "wrong-scope-applied"),
		).toMatchObject({
			observationCount: 1,
			invalidActionCount: 2,
			harmfulActionCount: 1,
		});
	});

	it("fails closed on inconsistent evidence and duplicate matched arms", () => {
		expect(() =>
			aggregateDeveloperGuidanceScorecard([
				{
					...observation({ id: "bad", arm: "relevant-applied" }),
					evidence: {
						...observation({ id: "bad-source", arm: "relevant-applied" }).evidence,
						validActionObserved: false,
					},
				},
			]),
		).toThrow(/valid action coordinates are inconsistent/);
		expect(() =>
			aggregateDeveloperGuidanceScorecard([
				observation({ id: "duplicate-a", arm: "relevant-applied" }),
				observation({ id: "duplicate-b", arm: "relevant-applied" }),
			]),
		).toThrow(/arm must be unique/);
		expect(() =>
			aggregateDeveloperGuidanceScorecard([
				observation({ id: "control-a", arm: "irrelevant-applied" }),
				observation({ id: "control-b", arm: "irrelevant-applied" }),
			]),
		).toThrow(/arm must be unique/);
		expect(() =>
			aggregateDeveloperGuidanceScorecard([
				observation({ id: "coordinate-a", arm: "relevant-applied" }),
				{
					...observation({ id: "coordinate-b", arm: "proposal-only" }),
					comparisonCoordinatesDigest: `sha256:${"b".repeat(64)}`,
				},
			]),
		).toThrow(/changed frozen coordinates/);
		expect(() =>
			aggregateDeveloperGuidanceScorecard([
				observation({ id: "source-a", arm: "relevant-applied" }),
				{
					...observation({ id: "source-b", arm: "proposal-only" }),
					evidence: {
						...observation({ id: "source-b", arm: "proposal-only" }).evidence,
						sourceObservationDigest: `sha256:${"9".repeat(64)}`,
					},
				},
			]),
		).toThrow(/changed frozen coordinates/);
	});
});
