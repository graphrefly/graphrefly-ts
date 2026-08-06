import { createHash } from "node:crypto";
import { strictJsonCodec } from "../../src/json/codec.js";
import { D686_SCENARIOS, type D686Category, type D686PathObservation } from "./contracts.js";
import { runD686ManualGraphReFlyArm } from "./manual-graphrefly-arm.js";
import { runD686PlainTypescriptArm } from "./plain-typescript-arm.js";
import { runD686RecipeArm } from "./recipe-arm.js";
import {
	auditD686CoordinatorSources,
	auditD686RecipeBoundaries,
	type D686SourceInput,
} from "./source-audit.js";

export const D686_SCORECARD_VERSION =
	"graphrefly-work-item-execution-project-fit-scorecard.d686.v2";
export const D686_CLAIM_BOUNDARY =
	"artifact-backed-comparative-project-fit-case-study-not-universal-superiority";

function digest(value: unknown): string {
	return `sha256:${createHash("sha256").update(strictJsonCodec.encode(value)).digest("hex")}`;
}

function expectedProjection(
	observation: Pick<D686PathObservation, "category" | "scenarioId">,
): Omit<
	D686PathObservation,
	| "arm"
	| "scenarioId"
	| "category"
	| "admissionTrace"
	| "issuedRequestIds"
	| "requestBindings"
	| "provenanceAuthority"
	| "topology"
> {
	switch (observation.category) {
		case "dependency-rich-fan-out-fan-in":
			if (observation.scenarioId === "d686-dependency-rich-base") {
				return {
					admittedMemberIds: ["load", "left", "right", "join"],
					completedMemberIds: ["load", "left", "right", "join"],
					failedMemberIds: [],
					blockedMemberIds: [],
					rejectionCodes: [],
					terminalStatus: "succeeded",
				};
			}
			return {
				admittedMemberIds: ["load", "left", "right", "audit", "join"],
				completedMemberIds: ["load", "left", "right", "audit", "join"],
				failedMemberIds: [],
				blockedMemberIds: [],
				rejectionCodes: [],
				terminalStatus: "succeeded",
			};
		case "failed-prerequisite-independent-branch-join":
			return {
				admittedMemberIds: ["root", "independent", "failing"],
				completedMemberIds: ["root", "independent"],
				failedMemberIds: ["failing"],
				blockedMemberIds: ["join"],
				rejectionCodes: [],
				terminalStatus: "failed",
			};
		case "provenance-and-fault-governance":
			return {
				admittedMemberIds: ["root"],
				completedMemberIds: ["root"],
				failedMemberIds: [],
				blockedMemberIds: [],
				rejectionCodes: [
					"duplicate-completion",
					"late-completion",
					"stale-completion",
					"wrong-operation-completion",
				],
				terminalStatus: "succeeded",
			};
		case "simple-linear-negative-control":
			return {
				admittedMemberIds: ["first", "second"],
				completedMemberIds: ["first", "second"],
				failedMemberIds: [],
				blockedMemberIds: [],
				rejectionCodes: [],
				terminalStatus: "succeeded",
			};
	}
}

function behaviorProjection(observation: D686PathObservation): unknown {
	return {
		admittedMemberIds: observation.admittedMemberIds,
		completedMemberIds: observation.completedMemberIds,
		failedMemberIds: observation.failedMemberIds,
		blockedMemberIds: observation.blockedMemberIds,
		rejectionCodes: observation.rejectionCodes,
		terminalStatus: observation.terminalStatus,
	};
}

function verifyObservation(observation: D686PathObservation): boolean {
	const expected = expectedProjection(observation);
	if (digest(behaviorProjection(observation)) !== digest(expected)) return false;
	const scenario = D686_SCENARIOS.find(
		(candidate) => candidate.scenarioId === observation.scenarioId,
	);
	if (
		scenario === undefined ||
		observation.admissionTrace.length !== observation.admittedMemberIds.length
	)
		return false;
	for (const [index, admission] of observation.admissionTrace.entries()) {
		if (admission.memberId !== observation.admittedMemberIds[index]) return false;
		const member = scenario.members.find((candidate) => candidate.memberId === admission.memberId);
		if (member === undefined) return false;
		if (
			member.dependsOnMemberIds.some(
				(dependency) => admission.prerequisiteStatuses[dependency] !== "completed",
			)
		)
			return false;
	}
	if (observation.issuedRequestIds.length !== observation.admittedMemberIds.length) return false;
	if (new Set(observation.issuedRequestIds).size !== observation.issuedRequestIds.length)
		return false;
	if (observation.requestBindings.length !== observation.issuedRequestIds.length) return false;
	return observation.requestBindings.every(
		(binding, index) =>
			binding.memberId === observation.admittedMemberIds[index] &&
			binding.requestId === observation.issuedRequestIds[index] &&
			binding.effectRunId.length > 0 &&
			binding.operationId.length > 0,
	);
}

export interface D686EvidenceInput {
	readonly preregistration: unknown;
	readonly armSources: readonly D686SourceInput[];
	readonly candidateSource: string;
	readonly recipeArmSource: string;
}

export function runD686ProjectFitEvidence(input: D686EvidenceInput) {
	const preregistrationDigest = digest(input.preregistration);
	const scenarios = D686_SCENARIOS.map((scenario) => {
		const observations = [
			runD686RecipeArm(scenario),
			runD686ManualGraphReFlyArm(scenario),
			runD686PlainTypescriptArm(scenario),
		];
		const verifierPassed = observations.every(verifyObservation);
		const behaviorallyEquivalent =
			new Set(observations.map((observation) => digest(behaviorProjection(observation)))).size ===
			1;
		return {
			scenarioId: scenario.scenarioId,
			category: scenario.category,
			verifierPassed,
			behaviorallyEquivalent,
			observations,
		};
	});
	const sourceAudit = auditD686CoordinatorSources(input.armSources);
	const recipeBoundaries = auditD686RecipeBoundaries(input);
	const favorableScenarios = scenarios.filter(
		(scenario) => scenario.category !== "simple-linear-negative-control",
	);
	const allFavorableFinalOutcomeAndReadinessVerifiersPass = favorableScenarios.every(
		(scenario) => scenario.verifierPassed && scenario.behaviorallyEquivalent,
	);
	const armIndependenceQualified = false;
	const sourceAuditQualified = sourceAudit.measurementQualified;
	const allFavorableBehaviorAndProvenanceInvariantsPass =
		allFavorableFinalOutcomeAndReadinessVerifiersPass && armIndependenceQualified;
	const remainingFavorableCategoriesNonInferior = false;
	const forbiddenRecipeMechanismsAbsent =
		!recipeBoundaries.handwrittenDependencyScheduler &&
		!recipeBoundaries.mutableReadinessTable &&
		!recipeBoundaries.executionAuthority &&
		!recipeBoundaries.linearControlExtraStateMachine;
	const promotionPassed =
		allFavorableBehaviorAndProvenanceInvariantsPass &&
		sourceAuditQualified &&
		remainingFavorableCategoriesNonInferior &&
		forbiddenRecipeMechanismsAbsent &&
		scenarios.find((scenario) => scenario.category === "simple-linear-negative-control")
			?.verifierPassed === true;
	const withoutDigest = {
		version: D686_SCORECARD_VERSION,
		authority: ["D686", "D687"],
		claimBoundary: D686_CLAIM_BOUNDARY,
		preregistrationDigest,
		qualificationStatus: "partial-offline" as const,
		missingEvidence: [
			"independent-arm-provenance-implementations",
			"committed-before-after-category-change-surfaces",
		] as const,
		networkCalls: 0,
		scenarios,
		sourceAudit,
		recipeBoundaries,
		promotionGate: {
			apiPromotionAuthority: false,
			allFavorableFinalOutcomeAndReadinessVerifiersPass,
			allFavorableBehaviorAndProvenanceInvariantsPass,
			armIndependenceQualified,
			sourceAuditQualified,
			strictlyLowerCategoryCount: 0,
			strictlyLowerCategories: [] as readonly D686Category[],
			remainingFavorableCategoriesNonInferior,
			forbiddenRecipeMechanismsAbsent,
			linearNegativeControlPassed:
				scenarios.find((scenario) => scenario.category === "simple-linear-negative-control")
					?.verifierPassed === true,
			promotionPassed,
		},
		exportDisposition: "showcase-only-no-api-promotion-authority",
		publicClaim: "comparative-project-fit-case-study",
	};
	return Object.freeze({ ...withoutDigest, evidenceDigest: digest(withoutDigest) });
}
