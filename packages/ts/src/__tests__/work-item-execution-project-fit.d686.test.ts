import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { D686_SCENARIOS } from "../../evals/work-item-execution-project-fit/contracts.js";
import {
	D686_CLAIM_BOUNDARY,
	D686_SCORECARD_VERSION,
	runD686ProjectFitEvidence,
} from "../../evals/work-item-execution-project-fit/evidence.js";

const RECIPE_ARM_PATH = "packages/ts/evals/work-item-execution-project-fit/recipe-arm.ts";
const MANUAL_ARM_PATH =
	"packages/ts/evals/work-item-execution-project-fit/manual-graphrefly-arm.ts";
const PLAIN_ARM_PATH = "packages/ts/evals/work-item-execution-project-fit/plain-typescript-arm.ts";
const GRAPH_HARNESS_PATH = "packages/ts/evals/work-item-execution-project-fit/graph-arm-harness.ts";
const CANDIDATE_PATH = "packages/ts/src/solutions/work-item/execution.ts";

function repositorySource(path: string): string {
	return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

function evidence() {
	const recipeArmSource = repositorySource(RECIPE_ARM_PATH);
	const graphHarnessSource = repositorySource(GRAPH_HARNESS_PATH);
	return runD686ProjectFitEvidence({
		preregistration: JSON.parse(
			readFileSync(
				new URL(
					"../../evals/work-item-execution-project-fit/d686-preregistration.json",
					import.meta.url,
				),
				"utf8",
			),
		),
		armSources: [
			{
				arm: "default-recipe",
				path: `${RECIPE_ARM_PATH}+${GRAPH_HARNESS_PATH}`,
				source: `${recipeArmSource}\n${graphHarnessSource}`,
			},
			{
				arm: "manual-graphrefly",
				path: `${MANUAL_ARM_PATH}+${GRAPH_HARNESS_PATH}`,
				source: `${repositorySource(MANUAL_ARM_PATH)}\n${graphHarnessSource}`,
			},
			{
				arm: "plain-typescript",
				path: PLAIN_ARM_PATH,
				source: repositorySource(PLAIN_ARM_PATH),
			},
		],
		candidateSource: repositorySource(CANDIDATE_PATH),
		recipeArmSource,
	});
}

describe("D686 WorkItem execution project-fit evidence", () => {
	it("runs the preregistered categories while keeping shared-harness attribution explicit", () => {
		const scorecard = evidence();

		expect(scorecard).toMatchObject({
			version: D686_SCORECARD_VERSION,
			claimBoundary: D686_CLAIM_BOUNDARY,
			networkCalls: 0,
			publicClaim: "comparative-project-fit-case-study",
			qualificationStatus: "partial-offline",
			missingEvidence: [
				"independent-arm-provenance-implementations",
				"committed-before-after-category-change-surfaces",
			],
			promotionGate: {
				allFavorableFinalOutcomeAndReadinessVerifiersPass: true,
				allFavorableBehaviorAndProvenanceInvariantsPass: false,
				armIndependenceQualified: false,
				sourceAuditQualified: false,
				remainingFavorableCategoriesNonInferior: false,
				forbiddenRecipeMechanismsAbsent: true,
				linearNegativeControlPassed: true,
				promotionPassed: false,
			},
		});
		expect(scorecard.scenarios).toHaveLength(5);
		for (const scenario of scorecard.scenarios) {
			expect(scenario.verifierPassed).toBe(true);
			expect(scenario.behaviorallyEquivalent).toBe(true);
			expect(scenario.observations).toHaveLength(3);
			for (const observation of scenario.observations) {
				for (const admission of observation.admissionTrace) {
					const member = D686_SCENARIOS.find(
						(candidate) => candidate.scenarioId === scenario.scenarioId,
					)!.members.find((candidate) => candidate.memberId === admission.memberId)!;
					for (const dependency of member.dependsOnMemberIds) {
						expect(admission.prerequisiteStatuses[dependency]).toBe("completed");
					}
				}
			}
		}
		const failedScenario = D686_SCENARIOS.find(
			(scenario) => scenario.scenarioId === "d686-failed-prerequisite",
		)!;
		expect(
			failedScenario.members.find((member) => member.memberId === "independent")?.required,
		).toBe(false);
		expect(scorecard.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it("reports marker proxies without promoting them to qualified change-surface evidence", () => {
		const scorecard = evidence();

		expect(scorecard.promotionGate.strictlyLowerCategoryCount).toBe(0);
		expect(scorecard.sourceAudit.measurementQualified).toBe(false);
		expect(scorecard.sourceAudit.rawMarkerStrictlyLowerCategories).toHaveLength(2);
		expect(scorecard.sourceAudit.rawMarkerNonInferiorCategories).toHaveLength(2);
		for (const category of scorecard.sourceAudit.rawMarkerStrictlyLowerCategories) {
			const recipe = scorecard.sourceAudit.surfaces.find(
				(surface) => surface.arm === "default-recipe" && surface.category === category,
			)!;
			const plain = scorecard.sourceAudit.surfaces.find(
				(surface) => surface.arm === "plain-typescript" && surface.category === category,
			)!;
			expect(recipe.coordinationStatementCount).toBeLessThan(plain.coordinationStatementCount);
		}
	});

	it("blocks the focused export when caller-owned provenance admission is not non-inferior", () => {
		const scorecard = evidence();
		const recipe = scorecard.sourceAudit.surfaces.find(
			(surface) =>
				surface.arm === "default-recipe" && surface.category === "provenance-and-fault-governance",
		)!;
		const plain = scorecard.sourceAudit.surfaces.find(
			(surface) =>
				surface.arm === "plain-typescript" &&
				surface.category === "provenance-and-fault-governance",
		)!;
		const packageJson = JSON.parse(
			readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
		) as { readonly exports?: Record<string, unknown> };

		expect(recipe.coordinationStatementCount).toBeGreaterThan(plain.coordinationStatementCount);
		expect(packageJson.exports?.["./solutions/work-item/execution"]).toBeUndefined();
	});

	it("keeps the plain TypeScript arm independent of GraphReFly imports", () => {
		const source = repositorySource(PLAIN_ARM_PATH);

		expect(source).not.toMatch(/@graphrefly\/ts/);
		expect(source).not.toMatch(/\.\.\/\.\.\/src\//);
	});

	it("produces identical canonical scorecards from identical frozen inputs", () => {
		const scorecard = evidence();
		const qualified = JSON.parse(
			readFileSync(
				new URL(
					"../../evals/work-item-execution-project-fit/d686-qualified-evidence.json",
					import.meta.url,
				),
				"utf8",
			),
		) as {
			readonly preregistrationDigest: string;
			readonly scorecardDigest: string;
			readonly sourceCoordinates: {
				readonly defaultRecipeArmAndSharedHarness: string;
				readonly manualGraphReFlyArmAndSharedHarness: string;
				readonly plainTypescriptArm: string;
				readonly candidate: string;
			};
			readonly promotionGate: { readonly promotionPassed: boolean };
		};
		const sourceDigestFor = (arm: "default-recipe" | "manual-graphrefly" | "plain-typescript") =>
			scorecard.sourceAudit.sources.find((source) => source.arm === arm)?.sourceDigest;

		expect(scorecard).toEqual(evidence());
		expect(scorecard.preregistrationDigest).toBe(qualified.preregistrationDigest);
		expect(scorecard.evidenceDigest).toBe(qualified.scorecardDigest);
		expect(sourceDigestFor("default-recipe")).toBe(
			qualified.sourceCoordinates.defaultRecipeArmAndSharedHarness,
		);
		expect(sourceDigestFor("manual-graphrefly")).toBe(
			qualified.sourceCoordinates.manualGraphReFlyArmAndSharedHarness,
		);
		expect(sourceDigestFor("plain-typescript")).toBe(
			qualified.sourceCoordinates.plainTypescriptArm,
		);
		expect(scorecard.recipeBoundaries.candidateSourceDigest).toBe(
			qualified.sourceCoordinates.candidate,
		);
		expect(scorecard.promotionGate.promotionPassed).toBe(qualified.promotionGate.promotionPassed);
	});
});
