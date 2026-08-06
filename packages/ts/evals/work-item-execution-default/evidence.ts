import { createHash } from "node:crypto";
import ts from "typescript";
import { graph } from "../../src/graph/graph.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	EffectRun,
} from "../../src/orchestration/agent-runtime.js";
import {
	type WorkItemEffectRequested,
	type WorkItemSeed,
	workItemEffectRunProjector,
} from "../../src/orchestration/work-item-runtime.js";
import { D687_SCENARIOS, type D687Observation, type D687Scenario } from "./contracts.js";
import { runD687Arm } from "./harness.js";
import { composeD687ManualArm } from "./manual-arm.js";
import { composeD687RecipeArm } from "./recipe-arm.js";

export const D687_SCORECARD_VERSION = "graphrefly-work-item-execution-default-scorecard.d687.v1";

function digest(value: unknown): string {
	return `sha256:${createHash("sha256").update(strictJsonCodec.encode(value)).digest("hex")}`;
}

function semanticProjection(observation: D687Observation): Omit<D687Observation, "arm"> {
	const { arm: _arm, ...semantic } = observation;
	return semantic;
}

function functionMetrics(
	source: string,
	bindingName: string,
): {
	readonly statementCount: number;
	readonly callCount: number;
	readonly loopCount: number;
	readonly stateAccessCount: number;
} {
	const file = ts.createSourceFile(`${bindingName}.ts`, source, ts.ScriptTarget.Latest, true);
	let target: ts.Node | undefined;
	const locate = (node: ts.Node): void => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === bindingName &&
			node.initializer !== undefined
		) {
			target = node.initializer;
		}
		ts.forEachChild(node, locate);
	};
	locate(file);
	if (target === undefined) throw new TypeError(`D687 source is missing ${bindingName}`);
	let statementCount = 0;
	let callCount = 0;
	let loopCount = 0;
	let stateAccessCount = 0;
	const visit = (node: ts.Node): void => {
		if (ts.isStatement(node) && !ts.isBlock(node) && !ts.isEmptyStatement(node)) {
			statementCount += 1;
		}
		if (ts.isCallExpression(node)) callCount += 1;
		if (
			ts.isForStatement(node) ||
			ts.isForInStatement(node) ||
			ts.isForOfStatement(node) ||
			ts.isWhileStatement(node) ||
			ts.isDoStatement(node)
		) {
			loopCount += 1;
		}
		if (
			ts.isPropertyAccessExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text === "ctx" &&
			node.expression.name.text === "state"
		) {
			stateAccessCount += 1;
		}
		ts.forEachChild(node, visit);
	};
	visit(target);
	return { statementCount, callCount, loopCount, stateAccessCount };
}

function forbiddenAuthorityCalls(source: string): readonly string[] {
	const file = ts.createSourceFile("execution.ts", source, ts.ScriptTarget.Latest, true);
	const forbidden = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const expression = node.expression;
			const name = ts.isIdentifier(expression)
				? expression.text
				: ts.isPropertyAccessExpression(expression)
					? expression.name.text
					: undefined;
			if (
				name !== undefined &&
				[
					"fetch",
					"setTimeout",
					"setInterval",
					"retry",
					"enqueue",
					"execute",
					"dispatch",
					"route",
				].includes(name)
			) {
				forbidden.add(name);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return [...forbidden].sort();
}

function requiredFalsePreserved(observations: readonly D687Observation[]): boolean {
	return observations
		.filter((observation) => observation.scenarioId === "optional-and-failed-prerequisite")
		.every((observation) => {
			const effectRequest = (
				observation.effectRequests as readonly {
					readonly planMemberId?: string;
					readonly required?: boolean;
				}[]
			).find((request) => request.planMemberId === "optional");
			const run = (observation.effectRuns as readonly EffectRun[]).find(
				(candidate) => candidate.metadata?.planMemberId === "optional",
			);
			const proposal = (observation.requestFacts as readonly AgentRequestFact[]).find(
				(candidate) =>
					candidate.kind === "proposal" &&
					(candidate.input?.value as { readonly memberId?: string } | undefined)?.memberId ===
						"optional",
			);
			const issued = (observation.issuedRequests as readonly AgentRequestIssued[]).find(
				(request) =>
					request.required === false &&
					(request.input?.value as { readonly memberId?: string } | undefined)?.memberId ===
						"optional",
			);
			return (
				effectRequest?.required === false &&
				run?.required === false &&
				proposal?.required === false &&
				issued?.required === false
			);
		});
}

function propagationPreserved(observations: readonly D687Observation[]): boolean {
	const relevant = observations.filter(
		(observation) => observation.scenarioId === "multi-work-item-propagation-and-duplicate",
	);
	return relevant.every((observation) => {
		const runs = observation.effectRuns as readonly EffectRun[];
		const requests = observation.issuedRequests as readonly AgentRequestIssued[];
		return (
			runs.length === 2 &&
			requests.length === 2 &&
			runs.every(
				(run) =>
					run.limits?.maxRequests === 1 &&
					(run.policyRefs?.length ?? 0) > 0 &&
					(run.sourceRefs?.length ?? 0) > 0,
			) &&
			requests.every((request) => request.input?.value !== undefined)
		);
	});
}

function observationMemberIds(observation: D687Observation): string[] {
	return (observation.issuedRequests as readonly AgentRequestIssued[])
		.map((request) =>
			String((request.input?.value as { readonly memberId?: string } | undefined)?.memberId ?? ""),
		)
		.sort();
}

function verifyFrozenScenario(scenario: D687Scenario, observation: D687Observation): boolean {
	const runs = observation.effectRuns as readonly EffectRun[];
	const effectRequests = observation.effectRequests as readonly {
		readonly planMemberId?: string;
		readonly required?: boolean;
	}[];
	const requestFacts = observation.requestFacts as readonly AgentRequestFact[];
	const requests = observation.issuedRequests as readonly AgentRequestIssued[];
	const expectedMembers = scenario.workItems
		.flatMap((item) => item.members)
		.filter((member) => member.memberId !== "blocked-join");
	if (
		digest(observationMemberIds(observation)) !==
		digest(expectedMembers.map((member) => member.memberId).sort())
	)
		return false;
	if (runs.length !== expectedMembers.length || requests.length !== expectedMembers.length)
		return false;
	for (const member of expectedMembers) {
		const effectRequest = effectRequests.find(
			(candidate) => candidate.planMemberId === member.memberId,
		);
		const run = runs.find((candidate) => candidate.metadata?.planMemberId === member.memberId);
		const proposal = requestFacts.find(
			(candidate) =>
				candidate.kind === "proposal" &&
				(candidate.input?.value as { readonly memberId?: string } | undefined)?.memberId ===
					member.memberId,
		);
		const request = requests.find(
			(candidate) =>
				(candidate.input?.value as { readonly memberId?: string } | undefined)?.memberId ===
				member.memberId,
		);
		if (
			effectRequest === undefined ||
			run === undefined ||
			proposal === undefined ||
			request === undefined
		)
			return false;
		if (run.metadata?.effectKind !== member.effectKind) return false;
		if (digest(run.limits ?? null) !== digest(member.limits ?? null)) return false;
		if (effectRequest.required !== member.required) return false;
		if (run.required !== member.required) return false;
		if (proposal.required !== member.required) return false;
		if (request.required !== (member.required ?? true)) return false;
		if (digest(request.payload) !== digest(member.input)) return false;
		for (const ref of member.policyRefs ?? []) {
			if (!run.policyRefs?.some((candidate) => digest(candidate) === digest(ref))) return false;
		}
		for (const ref of member.sourceRefs ?? []) {
			if (!run.sourceRefs?.some((candidate) => digest(candidate) === digest(ref))) return false;
		}
	}
	const results = observation.planResults as readonly {
		readonly status: string;
		readonly memberResults: readonly { readonly planMemberId: string; readonly status: string }[];
	}[];
	switch (scenario.scenarioId) {
		case "linear":
			return (
				results.length === 1 &&
				results[0]?.status === "succeeded" &&
				digest(results[0].memberResults.map((result) => result.planMemberId)) ===
					digest(["first", "second"])
			);
		case "fan-out-fan-in-diamond":
			return (
				results.length === 1 &&
				results[0]?.status === "succeeded" &&
				digest(results[0].memberResults.map((result) => result.planMemberId)) ===
					digest(["root", "left", "right", "join"])
			);
		case "optional-and-failed-prerequisite":
			return (
				results.length === 1 &&
				results[0]?.status === "failed" &&
				!observationMemberIds(observation).includes("blocked-join") &&
				digest(results[0].memberResults.map((result) => [result.planMemberId, result.status])) ===
					digest([
						["root", "completed"],
						["optional", "completed"],
						["failing", "failed"],
					])
			);
		case "evidence-only-join":
			return results.length === 1 && results[0]?.status === "evidence-only";
		case "multi-work-item-propagation-and-duplicate":
			return (
				results.length === 2 &&
				results.every((result) => result.status === "succeeded") &&
				(observation.workItemSeeds as readonly WorkItemSeed[]).every((seed) => {
					const item = scenario.workItems.find(
						(candidate) => candidate.workItemId === seed.workItemId,
					);
					return (
						item !== undefined &&
						seed.metadata?.authoringRevision === item.authoringRevision &&
						seed.metadata?.executionInputRevision === item.executionInputRevision
					);
				})
			);
	}
}

function duplicateEffectRunSuppressionPassed(): boolean {
	const g = graph({ name: "d687/duplicate-effect-run" });
	const workItems = g.node<WorkItemSeed>([], null, { name: "d687/duplicate/workItems" });
	const requests = g.node<WorkItemEffectRequested>([], null, {
		name: "d687/duplicate/requests",
	});
	const projected = workItemEffectRunProjector(g, { workItems, effectRequests: requests });
	const runs: EffectRun[] = [];
	const issueCodes: string[] = [];
	projected.effectRuns.subscribe((message) => {
		if (message[0] === "DATA") runs.push(message[1] as EffectRun);
	});
	projected.issues.subscribe((message) => {
		if (message[0] === "DATA") issueCodes.push((message[1] as { readonly code: string }).code);
	});
	workItems.down([["DATA", { kind: "work-item", workItemId: "d687-duplicate" }]]);
	const request = {
		kind: "work-item-effect-requested" as const,
		requestId: "d687-request-1",
		workItemId: "d687-duplicate",
		effectRunId: "d687-shared-effect-run",
		effectKind: "d687-duplicate-check",
		goal: { kind: "d687-duplicate-check" },
	};
	requests.down([
		["DATA", request],
		["DATA", { ...request, requestId: "d687-request-2" }],
	]);
	return runs.length === 1 && issueCodes.includes("duplicate-work-item-effect-run");
}

function singleWorkItemProjectionInput(source: string): boolean {
	const file = ts.createSourceFile("execution.ts", source, ts.ScriptTarget.Latest, true);
	let members: readonly ts.TypeElement[] | undefined;
	const visit = (node: ts.Node): void => {
		if (ts.isInterfaceDeclaration(node) && node.name.text === "WorkItemExecutionRecipeOptions") {
			members = node.members;
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	if (members === undefined) return false;
	const names = members.flatMap((member) =>
		member.name !== undefined && ts.isIdentifier(member.name) ? [member.name.text] : [],
	);
	return (
		names.filter((name) => name === "workItems").length === 1 && !names.includes("workItemSeeds")
	);
}

export interface D687EvidenceInput {
	readonly preregistration: unknown;
	readonly manualArmSource: string;
	readonly recipeArmSource: string;
	readonly candidateSource: string;
	readonly packageJson: { readonly exports?: Record<string, unknown> };
	readonly tsupSource: string;
	readonly focusedEntry: Readonly<Record<string, unknown>>;
	readonly aggregateEntries: readonly Readonly<Record<string, unknown>>[];
	readonly aggregateSources: readonly string[];
	readonly orchestrationIndexSource: string;
	readonly schedulingIndexSource: string;
}

export function runD687DefaultQualification(input: D687EvidenceInput) {
	const pairs = D687_SCENARIOS.map((scenario) => {
		const manual = runD687Arm("current-primitives-manual", scenario, composeD687ManualArm);
		const recipe = runD687Arm("default-recipe", scenario, composeD687RecipeArm);
		return {
			scenarioId: scenario.scenarioId,
			manual,
			recipe,
			equivalent: digest(semanticProjection(manual)) === digest(semanticProjection(recipe)),
			manualExpectedOutcomeVerified: verifyFrozenScenario(scenario, manual),
			recipeExpectedOutcomeVerified: verifyFrozenScenario(scenario, recipe),
		};
	});
	const observations = pairs.flatMap((pair) => [pair.manual, pair.recipe]);
	const manualMetrics = functionMetrics(input.manualArmSource, "composeD687ManualArm");
	const recipeMetrics = functionMetrics(input.recipeArmSource, "composeD687RecipeArm");
	const forbiddenCalls = forbiddenAuthorityCalls(input.candidateSource);
	const allGeneralityCasesEquivalent = pairs.every((pair) => pair.equivalent);
	const allGeneralityCasesExpectedOutcomeVerified = pairs.every(
		(pair) => pair.manualExpectedOutcomeVerified && pair.recipeExpectedOutcomeVerified,
	);
	const requiredFalse = requiredFalsePreserved(observations);
	const propagation = propagationPreserved(observations);
	const duplicateSuppression = duplicateEffectRunSuppressionPassed();
	const consumerWiringStrictlyReduced =
		recipeMetrics.statementCount < manualMetrics.statementCount &&
		recipeMetrics.callCount < manualMetrics.callCount;
	const noExtraCoordinatorStateMachine =
		recipeMetrics.loopCount === 0 && recipeMetrics.stateAccessCount === 0;
	const noHiddenAuthority = forbiddenCalls.length === 0;
	const singleWorkItemInput = singleWorkItemProjectionInput(input.candidateSource);
	const packageEntryDeclarationAuditPassed =
		input.packageJson.exports?.["./solutions/work-item/execution"] !== undefined &&
		input.tsupSource.includes('"src/solutions/work-item/execution.ts"') &&
		typeof input.focusedEntry.workItemExecutionRecipe === "function" &&
		typeof input.focusedEntry.workItemSeedProjector === "function";
	const rootAndAggregatesUnchanged =
		input.aggregateEntries.every(
			(entry) => !("workItemExecutionRecipe" in entry) && !("workItemSeedProjector" in entry),
		) &&
		input.aggregateSources.every(
			(source) =>
				!source.includes("workItemExecutionRecipe") && !source.includes("workItemSeedProjector"),
		);
	const allowedPublicSourceModules = new Set([
		"../../src/core/index.js",
		"../../src/orchestration/index.js",
		"../../src/solutions/work-item/scheduling.js",
	]);
	const manualSourceModules = Array.from(
		input.manualArmSource.matchAll(/from\s+"([^"]+)"/g),
		(match) => match[1]!,
	);
	const manualArmUsesOnlyPublicPrimitiveModules =
		manualSourceModules
			.filter((source) => source.startsWith("../../src/"))
			.every((source) => allowedPublicSourceModules.has(source)) &&
		[...allowedPublicSourceModules].every((source) => manualSourceModules.includes(source));
	const advancedPrimitiveEscapeHatchPreserved =
		input.packageJson.exports?.["./orchestration"] !== undefined &&
		input.packageJson.exports?.["./solutions/work-item/scheduling"] !== undefined &&
		input.orchestrationIndexSource.includes('export * from "./agent-runtime.js"') &&
		input.schedulingIndexSource.includes('export * from "./scheduling-effect-plan.js"') &&
		manualArmUsesOnlyPublicPrimitiveModules;
	const withoutDigest = {
		version: D687_SCORECARD_VERSION,
		authority: ["D687"],
		preregistrationDigest: digest(input.preregistration),
		candidateSourceDigest: digest(input.candidateSource),
		manualArmSourceDigest: digest(input.manualArmSource),
		recipeArmSourceDigest: digest(input.recipeArmSource),
		claimBoundary: "graphrefly-current-library-versus-focused-default-qualification",
		networkCalls: 0,
		pairs,
		generality: {
			caseCount: pairs.length,
			allGeneralityCasesEquivalent,
			allGeneralityCasesExpectedOutcomeVerified,
			requiredFalsePreservedEndToEnd: requiredFalse,
			propagationPassed: propagation,
			duplicateEffectRunSuppressionPassed: duplicateSuppression,
		},
		ergonomics: {
			manual: manualMetrics,
			recipe: recipeMetrics,
			consumerWiringStrictlyReduced,
			sourceLinesAreAuxiliary: true,
		},
		boundaries: {
			forbiddenCalls,
			noHiddenAuthority,
			noExtraCoordinatorStateMachine,
			singleWorkItemProjectionInput: singleWorkItemInput,
			packageEntryDeclarationAuditPassed,
			rootAndAggregatesUnchanged,
			manualArmUsesOnlyPublicPrimitiveModules,
			advancedPrimitiveEscapeHatchPreserved,
		},
		promotionGate: {
			allGeneralityCasesEquivalent,
			allGeneralityCasesExpectedOutcomeVerified,
			requiredFalsePreservedEndToEnd: requiredFalse,
			propagationPassed: propagation,
			duplicateEffectRunSuppressionPassed: duplicateSuppression,
			consumerWiringStrictlyReduced,
			noHiddenAuthority,
			noExtraCoordinatorStateMachine,
			singleWorkItemProjectionInput: singleWorkItemInput,
			packageEntryDeclarationAuditPassed,
			rootAndAggregatesUnchanged,
			manualArmUsesOnlyPublicPrimitiveModules,
			advancedPrimitiveEscapeHatchPreserved,
			qualificationPassed:
				allGeneralityCasesEquivalent &&
				allGeneralityCasesExpectedOutcomeVerified &&
				requiredFalse &&
				propagation &&
				duplicateSuppression &&
				consumerWiringStrictlyReduced &&
				noHiddenAuthority &&
				noExtraCoordinatorStateMachine &&
				singleWorkItemInput &&
				packageEntryDeclarationAuditPassed &&
				rootAndAggregatesUnchanged &&
				manualArmUsesOnlyPublicPrimitiveModules &&
				advancedPrimitiveEscapeHatchPreserved,
		},
	};
	return Object.freeze({ ...withoutDigest, evidenceDigest: digest(withoutDigest) });
}
