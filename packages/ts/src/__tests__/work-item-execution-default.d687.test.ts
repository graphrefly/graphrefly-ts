import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	D687_SCORECARD_VERSION,
	runD687DefaultQualification,
} from "../../evals/work-item-execution-default/evidence.js";
import * as rootPackage from "../index.js";
import * as solutions from "../solutions/index.js";
import * as workItemExecution from "../solutions/work-item/execution.js";
import * as workItemSolution from "../solutions/work-item/index.js";

const PREREGISTRATION_PATH =
	"packages/ts/evals/work-item-execution-default/d687-preregistration.json";
const MANUAL_ARM_PATH = "packages/ts/evals/work-item-execution-default/manual-arm.ts";
const RECIPE_ARM_PATH = "packages/ts/evals/work-item-execution-default/recipe-arm.ts";
const CANDIDATE_PATH = "packages/ts/src/solutions/work-item/execution.ts";

function repositorySource(path: string): string {
	return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

function evidence() {
	const packageJson = JSON.parse(repositorySource("packages/ts/package.json")) as {
		readonly exports?: Record<string, unknown>;
	};
	return runD687DefaultQualification({
		preregistration: JSON.parse(repositorySource(PREREGISTRATION_PATH)),
		manualArmSource: repositorySource(MANUAL_ARM_PATH),
		recipeArmSource: repositorySource(RECIPE_ARM_PATH),
		candidateSource: repositorySource(CANDIDATE_PATH),
		packageJson,
		tsupSource: repositorySource("packages/ts/tsup.config.ts"),
		focusedEntry: workItemExecution,
		aggregateEntries: [rootPackage, solutions, workItemSolution],
		aggregateSources: [
			repositorySource("packages/ts/src/index.ts"),
			repositorySource("packages/ts/src/solutions/index.ts"),
			repositorySource("packages/ts/src/solutions/work-item/index.ts"),
		],
		orchestrationIndexSource: repositorySource("packages/ts/src/orchestration/index.ts"),
		schedulingIndexSource: repositorySource("packages/ts/src/solutions/work-item/scheduling.ts"),
	});
}

describe("D687 WorkItem focused default qualification", () => {
	it("preserves the frozen standard 1:1 DAG matrix", () => {
		const scorecard = evidence();

		expect(scorecard).toMatchObject({
			version: D687_SCORECARD_VERSION,
			authority: ["D687"],
			claimBoundary: "graphrefly-current-library-versus-focused-default-qualification",
			networkCalls: 0,
			generality: {
				caseCount: 5,
				allGeneralityCasesEquivalent: true,
				allGeneralityCasesExpectedOutcomeVerified: true,
				requiredFalsePreservedEndToEnd: true,
				propagationPassed: true,
				duplicateEffectRunSuppressionPassed: true,
			},
			promotionGate: { qualificationPassed: true },
		});
		expect(scorecard.pairs).toHaveLength(5);
		expect(
			scorecard.pairs.every(
				(pair) =>
					pair.equivalent &&
					pair.manualExpectedOutcomeVerified &&
					pair.recipeExpectedOutcomeVerified,
			),
		).toBe(true);
		expect(scorecard.pairs.map((pair) => pair.scenarioId)).toEqual([
			"linear",
			"fan-out-fan-in-diamond",
			"optional-and-failed-prerequisite",
			"evidence-only-join",
			"multi-work-item-propagation-and-duplicate",
		]);
	});

	it("keeps required, revisions, bounds and duplicate suppression graph-visible", () => {
		const scorecard = evidence();
		const optional = scorecard.pairs.find(
			(pair) => pair.scenarioId === "optional-and-failed-prerequisite",
		)!;
		const optionalRequest = optional.recipe.issuedRequests.find(
			(request) =>
				(request as { readonly input?: { readonly value?: { readonly memberId?: string } } }).input
					?.value?.memberId === "optional",
		) as { readonly required?: boolean } | undefined;
		expect(optionalRequest?.required).toBe(false);

		const multi = scorecard.pairs.find(
			(pair) => pair.scenarioId === "multi-work-item-propagation-and-duplicate",
		)!;
		expect(multi.recipe.workItemSeeds).toHaveLength(2);
		expect(multi.recipe.effectRuns).toHaveLength(2);
		expect(multi.recipe.issuedRequests).toHaveLength(2);
		expect(multi.recipe.workItemSeeds).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					workItemId: "d687-multi-a",
					metadata: expect.objectContaining({
						authoringRevision: 7,
						executionInputRevision: 11,
					}),
				}),
				expect.objectContaining({
					workItemId: "d687-multi-b",
					metadata: expect.objectContaining({
						authoringRevision: 8,
						executionInputRevision: 13,
					}),
				}),
			]),
		);
	});

	it("strictly reduces consumer wiring without adding execution authority", () => {
		const scorecard = evidence();

		expect(scorecard.ergonomics.recipe.statementCount).toBeLessThan(
			scorecard.ergonomics.manual.statementCount,
		);
		expect(scorecard.ergonomics.recipe.callCount).toBeLessThan(
			scorecard.ergonomics.manual.callCount,
		);
		expect(scorecard.boundaries).toEqual({
			forbiddenCalls: [],
			noHiddenAuthority: true,
			noExtraCoordinatorStateMachine: true,
			singleWorkItemProjectionInput: true,
			packageEntryDeclarationAuditPassed: true,
			rootAndAggregatesUnchanged: true,
			manualArmUsesOnlyPublicPrimitiveModules: true,
			advancedPrimitiveEscapeHatchPreserved: true,
		});
		expect(repositorySource(RECIPE_ARM_PATH)).not.toContain("workItemSeeds:");
	});

	it("publishes only the approved focused subpath", () => {
		const packageJson = JSON.parse(
			readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
		) as { readonly exports?: Record<string, unknown> };

		expect(packageJson.exports?.["./solutions/work-item/execution"]).toBeDefined();
		expect(typeof workItemExecution.workItemExecutionRecipe).toBe("function");
		expect(typeof workItemExecution.workItemSeedProjector).toBe("function");
		for (const aggregate of [rootPackage, solutions, workItemSolution]) {
			expect(Object.hasOwn(aggregate, "workItemExecutionRecipe")).toBe(false);
			expect(Object.hasOwn(aggregate, "workItemSeedProjector")).toBe(false);
		}
	});

	it("matches the frozen qualified evidence bytes", () => {
		const scorecard = evidence();
		const qualified = JSON.parse(
			repositorySource(
				"packages/ts/evals/work-item-execution-default/d687-qualified-evidence.json",
			),
		) as {
			readonly preregistrationDigest: string;
			readonly scorecardDigest: string;
			readonly sourceCoordinates: {
				readonly manualArm: string;
				readonly recipeArm: string;
				readonly candidate: string;
			};
			readonly promotionGate: {
				readonly offlineQualificationPassed: boolean;
				readonly packageEntrySmoke: {
					readonly esmImportPassed: boolean;
					readonly cjsRequirePassed: boolean;
					readonly declarationSmokePassed: boolean;
					readonly passed: boolean;
				};
				readonly promotionPassed: boolean;
			};
		};

		expect(scorecard).toEqual(evidence());
		expect(scorecard.preregistrationDigest).toBe(qualified.preregistrationDigest);
		expect(scorecard.evidenceDigest).toBe(qualified.scorecardDigest);
		expect(scorecard.manualArmSourceDigest).toBe(qualified.sourceCoordinates.manualArm);
		expect(scorecard.recipeArmSourceDigest).toBe(qualified.sourceCoordinates.recipeArm);
		expect(scorecard.candidateSourceDigest).toBe(qualified.sourceCoordinates.candidate);
		expect(scorecard.promotionGate.qualificationPassed).toBe(true);
		expect(qualified.promotionGate.offlineQualificationPassed).toBe(true);
		expect(qualified.promotionGate.packageEntrySmoke).toMatchObject({
			esmImportPassed: true,
			cjsRequirePassed: true,
			declarationSmokePassed: true,
			passed: true,
		});
		expect(qualified.promotionGate.promotionPassed).toBe(true);
	});
});
