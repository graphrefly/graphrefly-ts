import {
	array,
	coordinate,
	empiricalStrictJsonDigest,
	exactKeys,
	fail,
	finiteNumber,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type {
	EmpiricalCampaignTaskV1,
	EmpiricalTaskQualificationReportV1,
	EmpiricalWarmBranchKind,
	FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import { validateFrozenEmpiricalCampaignManifest } from "./qualification.js";

/**
 * Offline contract model for the frozen calibration schedule and D676 aggregation only.
 * These scripted values are never empirical observations, route evidence, verifier evidence,
 * spend authority, persistence input, or an efficacy claim. A live calibration must instead
 * derive a digest-bound projection from the existing fully validated matched-block evidence.
 */
export const B112_CALIBRATION_SIMULATION_BLOCK_SCHEMA =
	"graphrefly.private-solution-eval.b112-calibration-simulation-block.v1";
export const B112_CALIBRATION_SIMULATION_SUMMARY_SCHEMA =
	"graphrefly.private-solution-eval.b112-calibration-simulation-summary.v1";
export const B112_CALIBRATION_SIMULATION_CLAIM_BOUNDARY =
	"offline-contract-model-no-empirical-evidence";
export const B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION =
	"b112-task-clustered-exhaustive-bootstrap-nearest-rank-95.v1";

const MAX_CALIBRATION_BLOCKS = 15;
const MAX_ISSUE_CODES = 64;
const SECONDARY_BRANCH_KINDS = Object.freeze([
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

type SimulationArmOutcome =
	| "passed"
	| "failed"
	| "non-evaluable"
	| "budget-incomplete"
	| "not-attempted";

export interface B112CalibrationSimulationArmV1 {
	readonly branchKind: EmpiricalWarmBranchKind;
	readonly outcome: SimulationArmOutcome;
	readonly simulatedRequests: number;
	readonly issueCodes: readonly string[];
}

export interface B112CalibrationSimulationBlockV1 {
	readonly schemaVersion: typeof B112_CALIBRATION_SIMULATION_BLOCK_SCHEMA;
	readonly evidenceClass: "simulated-contract";
	readonly empiricalEvidence: false;
	readonly campaignRef: string;
	readonly manifestDigest: string;
	readonly configurationRef: string;
	readonly configurationDigest: string;
	readonly taskRef: string;
	readonly taskDigest: string;
	readonly blockIndex: 1 | 2 | 3;
	readonly coldOutcome: "passed" | "verified-failure" | "non-evaluable" | "budget-incomplete";
	readonly coldSimulatedRequests: number;
	readonly warmArms: readonly B112CalibrationSimulationArmV1[];
	readonly issueCodes: readonly string[];
}

export interface B112CalibrationSimulationTaskResultV1 {
	readonly taskRef: string;
	readonly attemptedBlocks: number;
	readonly eligibleColdFailures: number;
	readonly evaluablePrimaryPairs: number;
	readonly primaryEffect: number | null;
	readonly nonEvaluableBlocks: number;
}

export interface B112CalibrationSimulationComparisonV1 {
	readonly controlBranchKind: "proposal-only" | (typeof SECONDARY_BRANCH_KINDS)[number];
	readonly evaluableTaskClusters: number;
	readonly evaluablePairs: number;
	readonly relevantOnly: number;
	readonly controlOnly: number;
	readonly concordantPass: number;
	readonly concordantFail: number;
	readonly pointEstimate: number | null;
	readonly interval95: {
		readonly revision: typeof B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION;
		readonly confidenceLevel: 0.95;
		readonly lower: number;
		readonly upper: number;
		readonly resampleCount: number;
	} | null;
}

export interface B112CalibrationSimulationSummaryV1 {
	readonly schemaVersion: typeof B112_CALIBRATION_SIMULATION_SUMMARY_SCHEMA;
	readonly evidenceClass: "simulated-contract";
	readonly empiricalEvidence: false;
	readonly campaignRef: string;
	readonly manifestDigest: string;
	readonly configurationRef: string;
	readonly configurationDigest: string;
	readonly profile: "calibration";
	readonly efficacyClaim: "none";
	readonly claimBoundary: typeof B112_CALIBRATION_SIMULATION_CLAIM_BOUNDARY;
	readonly aggregationRevision: string;
	readonly intervalRevision: typeof B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION;
	readonly aggregationSeed: string;
	readonly simulationBlockDigests: readonly string[];
	readonly plannedBlocks: 15;
	readonly attemptedBlocks: number;
	readonly completeBlocks: number;
	readonly incompleteBlocks: number;
	readonly nonEvaluableBlocks: number;
	readonly eligibleColdFailures: number;
	readonly warmRunsAttempted: number;
	readonly warmRunsEvaluable: number;
	readonly taskResults: readonly B112CalibrationSimulationTaskResultV1[];
	readonly primaryComparison: B112CalibrationSimulationComparisonV1;
	readonly secondaryComparisons: readonly B112CalibrationSimulationComparisonV1[];
	readonly simulatedRequests: number;
	readonly status: "simulation-complete" | "incomplete";
	readonly issueCodes: readonly string[];
}

export interface B112CalibrationSimulationRunInputV1 {
	readonly configurationRef: string;
	readonly configurationDigest: string;
	readonly task: EmpiricalCampaignTaskV1;
	readonly taskDigest: string;
	readonly blockIndex: 1 | 2 | 3;
	readonly blockOrdinal: number;
	readonly remainingSimulatedRequests: {
		readonly campaign: number;
		readonly task: number;
	};
	readonly signal: AbortSignal;
}

export type B112CalibrationSimulationRunnerV1 = (
	input: B112CalibrationSimulationRunInputV1,
) => Promise<unknown>;

/** Copy own data entries without invoking a caller-controlled Array iterator or method. */
function canonicalArrayCopy(value: unknown, path: string): readonly unknown[] {
	const validated = array(value, path);
	const copy: unknown[] = [];
	for (let index = 0; index < validated.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(validated, String(index));
		if (descriptor === undefined || !("value" in descriptor)) {
			fail(`${path}[${index}]`, "expected an own data property");
		}
		copy.push(descriptor.value);
	}
	return copy;
}

function issueCodes(value: unknown, path: string): readonly string[] {
	const values = canonicalArrayCopy(value, path);
	if (values.length > MAX_ISSUE_CODES) fail(path, `expected at most ${MAX_ISSUE_CODES} entries`);
	const parsed: string[] = [];
	for (let index = 0; index < values.length; index += 1) {
		parsed.push(coordinate(values[index], `${path}[${index}]`));
	}
	if (new Set(parsed).size !== parsed.length) fail(path, "expected unique issue codes");
	const sorted = [...parsed].sort();
	if (parsed.some((entry, index) => entry !== sorted[index])) {
		fail(path, "issue codes must be sorted");
	}
	return Object.freeze(sorted);
}

function scriptedIssueCodes(value: unknown, path: string): readonly string[] {
	const parsed = issueCodes(value, path);
	if (parsed.some((issue) => issue.startsWith("simulation-"))) {
		fail(path, "simulation-* issue codes are reserved for the scheduler");
	}
	return parsed;
}

function normalizeZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}

function addSafe(total: number, value: number, path: string): number {
	const next = total + value;
	if (!Number.isSafeInteger(next)) fail(path, "safe integer overflow");
	return next;
}

function blockClassification(
	block: Pick<B112CalibrationSimulationBlockV1, "coldOutcome" | "warmArms">,
): "complete" | "incomplete" | "non-evaluable" {
	if (block.coldOutcome === "budget-incomplete") return "incomplete";
	if (block.coldOutcome === "non-evaluable") return "non-evaluable";
	if (block.coldOutcome === "passed") return "complete";
	if (
		block.warmArms.some(
			(arm) => arm.outcome === "budget-incomplete" || arm.outcome === "not-attempted",
		)
	) {
		return "incomplete";
	}
	if (block.warmArms.some((arm) => arm.outcome === "non-evaluable")) return "non-evaluable";
	return "complete";
}

function validateSimulationArm(
	value: unknown,
	expectedBranchKind: EmpiricalWarmBranchKind,
	maxRequests: number,
	path: string,
): B112CalibrationSimulationArmV1 {
	const arm = record(value, path);
	exactKeys(arm, ["branchKind", "issueCodes", "outcome", "simulatedRequests"], path);
	const outcome = oneOf(
		arm.outcome,
		["passed", "failed", "non-evaluable", "budget-incomplete", "not-attempted"],
		`${path}.outcome`,
	);
	const simulatedRequests = safeInteger(arm.simulatedRequests, `${path}.simulatedRequests`, {
		max: maxRequests,
	});
	if ((outcome === "passed" || outcome === "failed") && simulatedRequests < 1) {
		fail(`${path}.simulatedRequests`, "completed simulated run requires at least one request");
	}
	if (outcome === "not-attempted" && simulatedRequests !== 0) {
		fail(`${path}.simulatedRequests`, "unattempted simulated run requires zero requests");
	}
	const parsedIssueCodes = scriptedIssueCodes(arm.issueCodes, `${path}.issueCodes`);
	if (
		(outcome === "passed" || outcome === "failed" || outcome === "not-attempted") &&
		parsedIssueCodes.length !== 0
	) {
		fail(`${path}.issueCodes`, "completed or unattempted simulated run cannot carry issues");
	}
	if (
		(outcome === "non-evaluable" || outcome === "budget-incomplete") &&
		parsedIssueCodes.length === 0
	) {
		fail(`${path}.issueCodes`, "non-evaluable or incomplete simulated run requires an issue");
	}
	return strictSnapshot({
		branchKind: literal(arm.branchKind, expectedBranchKind, `${path}.branchKind`),
		outcome,
		simulatedRequests,
		issueCodes: parsedIssueCodes,
	});
}

function validateB112CalibrationSimulationBlock(
	value: unknown,
	expected: {
		readonly frozen: FrozenEmpiricalCampaignManifestV1;
		readonly task: EmpiricalCampaignTaskV1;
		readonly blockIndex: 1 | 2 | 3;
	},
): B112CalibrationSimulationBlockV1 {
	const block = record(value, "simulationBlock");
	exactKeys(
		block,
		[
			"blockIndex",
			"campaignRef",
			"coldSimulatedRequests",
			"coldOutcome",
			"empiricalEvidence",
			"evidenceClass",
			"configurationDigest",
			"configurationRef",
			"issueCodes",
			"manifestDigest",
			"schemaVersion",
			"taskDigest",
			"taskRef",
			"warmArms",
		],
		"simulationBlock",
	);
	literal(
		block.schemaVersion,
		B112_CALIBRATION_SIMULATION_BLOCK_SCHEMA,
		"simulationBlock.schemaVersion",
	);
	literal(block.evidenceClass, "simulated-contract", "simulationBlock.evidenceClass");
	literal(block.empiricalEvidence, false, "simulationBlock.empiricalEvidence");
	const campaignRef = coordinate(block.campaignRef, "simulationBlock.campaignRef");
	const manifestDigest = coordinate(block.manifestDigest, "simulationBlock.manifestDigest");
	const actorConfigurations = expected.frozen.manifest.modelConfigurations.filter(
		(configuration) => configuration.role === "actor",
	);
	if (actorConfigurations.length !== 1) {
		fail("simulationBlock.configuration", "expected exactly one frozen actor configuration");
	}
	const actorConfiguration = actorConfigurations[0] as (typeof actorConfigurations)[number];
	const configurationRef = coordinate(block.configurationRef, "simulationBlock.configurationRef");
	const configurationDigest = coordinate(
		block.configurationDigest,
		"simulationBlock.configurationDigest",
	);
	const taskRef = coordinate(block.taskRef, "simulationBlock.taskRef");
	const taskDigest = coordinate(block.taskDigest, "simulationBlock.taskDigest");
	const blockIndex = safeInteger(block.blockIndex, "simulationBlock.blockIndex", {
		min: 1,
		max: 3,
	}) as 1 | 2 | 3;
	if (
		campaignRef !== expected.frozen.manifest.campaignRef ||
		manifestDigest !== expected.frozen.manifestDigest ||
		configurationRef !== actorConfiguration.configurationRef ||
		configurationDigest !== empiricalStrictJsonDigest(actorConfiguration) ||
		taskRef !== expected.task.taskRef ||
		taskDigest !== empiricalStrictJsonDigest(expected.task) ||
		blockIndex !== expected.blockIndex
	) {
		fail("simulationBlock", "does not match the scheduled frozen task block");
	}
	const coldOutcome = oneOf(
		block.coldOutcome,
		["passed", "verified-failure", "non-evaluable", "budget-incomplete"],
		"simulationBlock.coldOutcome",
	);
	const perRunRequestLimit = expected.frozen.manifest.budgets.agentRun.maxRequests;
	const coldSimulatedRequests = safeInteger(
		block.coldSimulatedRequests,
		"simulationBlock.coldSimulatedRequests",
		{ max: perRunRequestLimit },
	);
	if (
		(coldOutcome === "passed" || coldOutcome === "verified-failure") &&
		coldSimulatedRequests < 1
	) {
		fail(
			"simulationBlock.coldSimulatedRequests",
			"completed simulated cold run requires at least one request",
		);
	}
	const armValues = canonicalArrayCopy(block.warmArms, "simulationBlock.warmArms");
	const branchOrder = expected.frozen.manifest.trialPlan.branchOrder;
	if (armValues.length !== branchOrder.length) {
		fail("simulationBlock.warmArms", "expected the exact five frozen warm branches");
	}
	const warmArms: B112CalibrationSimulationArmV1[] = [];
	for (let index = 0; index < armValues.length; index += 1) {
		warmArms.push(
			validateSimulationArm(
				armValues[index],
				branchOrder[index] as EmpiricalWarmBranchKind,
				perRunRequestLimit,
				`simulationBlock.warmArms[${index}]`,
			),
		);
	}
	if (
		coldOutcome !== "verified-failure" &&
		warmArms.some((arm) => arm.outcome !== "not-attempted")
	) {
		fail("simulationBlock.warmArms", "ineligible cold outcome cannot attempt warm branches");
	}
	const parsedIssueCodes = scriptedIssueCodes(block.issueCodes, "simulationBlock.issueCodes");
	const provisionalBlock = { coldOutcome, warmArms };
	const classification = blockClassification(provisionalBlock);
	if (classification === "complete" && parsedIssueCodes.length !== 0) {
		fail("simulationBlock.issueCodes", "complete simulated block cannot carry block issues");
	}
	if (
		(coldOutcome === "non-evaluable" ||
			coldOutcome === "budget-incomplete" ||
			(coldOutcome === "verified-failure" &&
				warmArms.some((arm) => arm.outcome === "not-attempted"))) &&
		parsedIssueCodes.length === 0
	) {
		fail("simulationBlock.issueCodes", "non-evaluable or incomplete cold path requires an issue");
	}
	return strictSnapshot({
		schemaVersion: B112_CALIBRATION_SIMULATION_BLOCK_SCHEMA,
		evidenceClass: "simulated-contract" as const,
		empiricalEvidence: false as const,
		campaignRef,
		manifestDigest,
		configurationRef,
		configurationDigest,
		taskRef,
		taskDigest,
		blockIndex,
		coldOutcome,
		coldSimulatedRequests,
		warmArms,
		issueCodes: parsedIssueCodes,
	});
}

function blockSimulatedRequests(block: B112CalibrationSimulationBlockV1): number {
	let total = block.coldSimulatedRequests;
	for (const arm of block.warmArms) {
		total = addSafe(total, arm.simulatedRequests, "simulationBlock.totalSimulatedRequests");
	}
	return total;
}

function nearestRank(sorted: readonly number[], probability: number): number {
	const rank = Math.max(1, Math.ceil(probability * sorted.length));
	return sorted[rank - 1] as number;
}

export function exhaustiveTaskClusterInterval95(
	taskEffectsValue: readonly number[],
): B112CalibrationSimulationComparisonV1["interval95"] {
	const values = canonicalArrayCopy(taskEffectsValue, "taskEffects");
	if (values.length > 5) fail("taskEffects", "expected at most five task clusters");
	const taskEffects: number[] = [];
	for (let index = 0; index < values.length; index += 1) {
		taskEffects.push(finiteNumber(values[index], `taskEffects[${index}]`, { min: -1, max: 1 }));
	}
	if (taskEffects.length < 2) return null;
	const means: number[] = [];
	const select = (depth: number, sum: number): void => {
		if (depth === taskEffects.length) {
			means.push(normalizeZero(sum / taskEffects.length));
			return;
		}
		for (let index = 0; index < taskEffects.length; index += 1) {
			select(depth + 1, sum + (taskEffects[index] as number));
		}
	};
	select(0, 0);
	means.sort((left, right) => left - right);
	return strictSnapshot({
		revision: B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION,
		confidenceLevel: 0.95 as const,
		lower: nearestRank(means, 0.025),
		upper: nearestRank(means, 0.975),
		resampleCount: means.length,
	});
}

function comparison(
	blocks: readonly B112CalibrationSimulationBlockV1[],
	taskRefs: readonly string[],
	controlBranchKind: B112CalibrationSimulationComparisonV1["controlBranchKind"],
): B112CalibrationSimulationComparisonV1 {
	let evaluablePairs = 0;
	let relevantOnly = 0;
	let controlOnly = 0;
	let concordantPass = 0;
	let concordantFail = 0;
	const taskEffects: number[] = [];
	for (const taskRef of taskRefs) {
		const differences: number[] = [];
		for (const block of blocks) {
			if (block.taskRef !== taskRef || block.coldOutcome !== "verified-failure") continue;
			const relevant = block.warmArms.find((arm) => arm.branchKind === "relevant-applied");
			const control = block.warmArms.find((arm) => arm.branchKind === controlBranchKind);
			const relevantEvaluable = relevant?.outcome === "passed" || relevant?.outcome === "failed";
			const controlEvaluable = control?.outcome === "passed" || control?.outcome === "failed";
			if (!relevantEvaluable || !controlEvaluable) continue;
			const relevantPass = relevant?.outcome === "passed" ? 1 : 0;
			const controlPass = control?.outcome === "passed" ? 1 : 0;
			differences.push(relevantPass - controlPass);
			evaluablePairs += 1;
			if (relevantPass === 1 && controlPass === 0) relevantOnly += 1;
			else if (relevantPass === 0 && controlPass === 1) controlOnly += 1;
			else if (relevantPass === 1) concordantPass += 1;
			else concordantFail += 1;
		}
		if (differences.length > 0) {
			taskEffects.push(
				normalizeZero(differences.reduce((total, value) => total + value, 0) / differences.length),
			);
		}
	}
	return strictSnapshot({
		controlBranchKind,
		evaluableTaskClusters: taskEffects.length,
		evaluablePairs,
		relevantOnly,
		controlOnly,
		concordantPass,
		concordantFail,
		pointEstimate:
			taskEffects.length === 0
				? null
				: normalizeZero(
						taskEffects.reduce((total, effect) => total + effect, 0) / taskEffects.length,
					),
		interval95: exhaustiveTaskClusterInterval95(taskEffects),
	});
}

function aggregateB112CalibrationSimulation(input: {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly blocks: readonly B112CalibrationSimulationBlockV1[];
	readonly schedulerBudgetExhausted: boolean;
}): B112CalibrationSimulationSummaryV1 {
	const trialPlan = input.frozen.manifest.trialPlan;
	if (trialPlan.profile !== "calibration")
		fail("simulation.profile", "requires calibration manifest");
	if (
		input.frozen.manifest.aggregation.intervalRevision !==
		B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION
	) {
		fail("simulation.intervalRevision", "does not select the D676 exhaustive interval");
	}
	const actorConfigurations = input.frozen.manifest.modelConfigurations.filter(
		(configuration) => configuration.role === "actor",
	);
	if (actorConfigurations.length !== 1) {
		fail("simulation.configuration", "expected exactly one frozen actor configuration");
	}
	const actorConfiguration = actorConfigurations[0] as (typeof actorConfigurations)[number];
	const blockValues = canonicalArrayCopy(input.blocks, "simulationBlocks");
	if (blockValues.length > MAX_CALIBRATION_BLOCKS) {
		fail("simulationBlocks", `expected at most ${MAX_CALIBRATION_BLOCKS} blocks`);
	}
	const blocks: B112CalibrationSimulationBlockV1[] = [];
	for (let index = 0; index < blockValues.length; index += 1) {
		const candidateRecord = record(blockValues[index], `simulationBlocks[${index}]`);
		const candidateTaskRef = coordinate(
			candidateRecord.taskRef,
			`simulationBlocks[${index}].taskRef`,
		);
		const task = input.frozen.manifest.catalog.tasks.find(
			(entry) => entry.taskRef === candidateTaskRef,
		);
		if (task === undefined) fail(`simulationBlocks[${index}].taskRef`, "unknown task");
		const candidateBlockIndex = safeInteger(
			candidateRecord.blockIndex,
			`simulationBlocks[${index}].blockIndex`,
			{ min: 1, max: 3 },
		) as 1 | 2 | 3;
		blocks.push(
			validateB112CalibrationSimulationBlock(candidateRecord, {
				frozen: input.frozen,
				task,
				blockIndex: candidateBlockIndex,
			}),
		);
	}
	const identities = blocks.map((block) => `${block.taskRef}\u0000${block.blockIndex}`);
	if (new Set(identities).size !== identities.length)
		fail("simulationBlocks", "duplicate task block");
	const expectedOrder = trialPlan.activeTaskRefs.flatMap((taskRef) =>
		([1, 2, 3] as const).map((blockIndex) => `${taskRef}\u0000${blockIndex}`),
	);
	let cursor = 0;
	for (const identity of identities) {
		const index = expectedOrder.indexOf(identity, cursor);
		if (index < 0) fail("simulationBlocks", "must preserve frozen task and block order");
		cursor = index + 1;
	}
	const classifications = blocks.map(blockClassification);
	let simulatedRequests = 0;
	for (const block of blocks) {
		simulatedRequests = addSafe(
			simulatedRequests,
			blockSimulatedRequests(block),
			"simulation.simulatedRequests",
		);
	}
	if (simulatedRequests > input.frozen.manifest.budgets.campaign.maxRequests) {
		fail("simulation.simulatedRequests", "exceeds the frozen campaign request budget");
	}
	for (const taskRef of trialPlan.activeTaskRefs) {
		let taskRequests = 0;
		for (const block of blocks) {
			if (block.taskRef === taskRef) {
				taskRequests = addSafe(
					taskRequests,
					blockSimulatedRequests(block),
					`simulation.taskRequests.${taskRef}`,
				);
			}
		}
		if (taskRequests > input.frozen.manifest.budgets.taskModel.maxRequests) {
			fail(`simulation.taskRequests.${taskRef}`, "exceeds the frozen task request budget");
		}
	}
	const taskResults = trialPlan.activeTaskRefs.map((taskRef) => {
		const taskBlocks = blocks.filter((block) => block.taskRef === taskRef);
		const primary = comparison(taskBlocks, [taskRef], "proposal-only");
		return strictSnapshot({
			taskRef,
			attemptedBlocks: taskBlocks.length,
			eligibleColdFailures: taskBlocks.filter((block) => block.coldOutcome === "verified-failure")
				.length,
			evaluablePrimaryPairs: primary.evaluablePairs,
			primaryEffect: primary.pointEstimate,
			nonEvaluableBlocks: taskBlocks.filter(
				(block) => blockClassification(block) === "non-evaluable",
			).length,
		});
	});
	const warmArms = blocks.flatMap((block) => block.warmArms);
	const issueList = [
		...blocks.flatMap((block) => block.issueCodes),
		...warmArms.flatMap((arm) => arm.issueCodes),
		...(input.schedulerBudgetExhausted ? ["simulation-request-budget-exhausted"] : []),
	];
	const uniqueIssues = [...new Set(issueList)].sort();
	if (uniqueIssues.length > MAX_ISSUE_CODES) fail("simulation.issueCodes", "too many issues");
	return strictSnapshot({
		schemaVersion: B112_CALIBRATION_SIMULATION_SUMMARY_SCHEMA,
		evidenceClass: "simulated-contract" as const,
		empiricalEvidence: false as const,
		campaignRef: input.frozen.manifest.campaignRef,
		manifestDigest: input.frozen.manifestDigest,
		configurationRef: actorConfiguration.configurationRef,
		configurationDigest: empiricalStrictJsonDigest(actorConfiguration),
		profile: "calibration" as const,
		efficacyClaim: "none" as const,
		claimBoundary: B112_CALIBRATION_SIMULATION_CLAIM_BOUNDARY,
		aggregationRevision: input.frozen.manifest.aggregation.aggregationRevision,
		intervalRevision: B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION,
		aggregationSeed: input.frozen.manifest.aggregation.aggregationSeed,
		simulationBlockDigests: blocks.map(empiricalStrictJsonDigest),
		plannedBlocks: MAX_CALIBRATION_BLOCKS as 15,
		attemptedBlocks: blocks.length,
		completeBlocks: classifications.filter((value) => value === "complete").length,
		incompleteBlocks: classifications.filter((value) => value === "incomplete").length,
		nonEvaluableBlocks: classifications.filter((value) => value === "non-evaluable").length,
		eligibleColdFailures: blocks.filter((block) => block.coldOutcome === "verified-failure").length,
		warmRunsAttempted: warmArms.filter((arm) => arm.outcome !== "not-attempted").length,
		warmRunsEvaluable: warmArms.filter(
			(arm) => arm.outcome === "passed" || arm.outcome === "failed",
		).length,
		taskResults,
		primaryComparison: comparison(blocks, trialPlan.activeTaskRefs, "proposal-only"),
		secondaryComparisons: SECONDARY_BRANCH_KINDS.map((branchKind) =>
			comparison(blocks, trialPlan.activeTaskRefs, branchKind),
		),
		simulatedRequests,
		status:
			blocks.length === MAX_CALIBRATION_BLOCKS &&
			classifications.every((value) => value === "complete") &&
			!input.schedulerBudgetExhausted
				? ("simulation-complete" as const)
				: ("incomplete" as const),
		issueCodes: uniqueIssues,
	});
}

export async function runB112CalibrationSimulation(input: {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly runScriptedBlock: B112CalibrationSimulationRunnerV1;
	readonly signal: AbortSignal;
}): Promise<{
	readonly blocks: readonly B112CalibrationSimulationBlockV1[];
	readonly summary: B112CalibrationSimulationSummaryV1;
}> {
	const request = record(input, "simulationRun");
	exactKeys(
		request,
		["frozen", "qualificationReport", "runScriptedBlock", "signal"],
		"simulationRun",
	);
	if (typeof request.runScriptedBlock !== "function") {
		fail("simulationRun.runScriptedBlock", "expected function capability");
	}
	if (!(request.signal instanceof AbortSignal)) {
		fail("simulationRun.signal", "expected AbortSignal capability");
	}
	const runScriptedBlock = request.runScriptedBlock as B112CalibrationSimulationRunnerV1;
	const signal = request.signal;
	const frozen = validateFrozenEmpiricalCampaignManifest(
		request.frozen as FrozenEmpiricalCampaignManifestV1,
		request.qualificationReport as EmpiricalTaskQualificationReportV1,
	);
	const trialPlan = frozen.manifest.trialPlan;
	if (trialPlan.profile !== "calibration")
		fail("simulation.profile", "requires calibration manifest");
	if (
		frozen.manifest.aggregation.intervalRevision !== B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION
	) {
		fail("simulation.intervalRevision", "does not select the D676 exhaustive interval");
	}
	const actorConfigurations = frozen.manifest.modelConfigurations.filter(
		(configuration) => configuration.role === "actor",
	);
	if (actorConfigurations.length !== 1) {
		fail("simulation.configuration", "expected exactly one frozen actor configuration");
	}
	const actorConfiguration = actorConfigurations[0] as (typeof actorConfigurations)[number];
	const configurationDigest = empiricalStrictJsonDigest(actorConfiguration);
	const blocks: B112CalibrationSimulationBlockV1[] = [];
	let campaignRequests = 0;
	let schedulerBudgetExhausted = false;
	let blockOrdinal = 0;
	for (const taskRef of trialPlan.activeTaskRefs) {
		const task = frozen.manifest.catalog.tasks.find((candidate) => candidate.taskRef === taskRef);
		if (task === undefined) fail("simulation.taskRef", "missing frozen calibration task");
		let taskRequests = 0;
		for (const blockIndex of [1, 2, 3] as const) {
			blockOrdinal += 1;
			if (signal.aborted) {
				throw new DOMException(
					"B112 calibration simulation cancelled between serial blocks",
					"AbortError",
				);
			}
			const remainingCampaign = frozen.manifest.budgets.campaign.maxRequests - campaignRequests;
			const remainingTask = frozen.manifest.budgets.taskModel.maxRequests - taskRequests;
			if (remainingCampaign <= 0 || remainingTask <= 0) {
				schedulerBudgetExhausted = true;
				continue;
			}
			const scriptedBlock = await runScriptedBlock({
				configurationRef: actorConfiguration.configurationRef,
				configurationDigest,
				task,
				taskDigest: empiricalStrictJsonDigest(task),
				blockIndex,
				blockOrdinal,
				remainingSimulatedRequests: { campaign: remainingCampaign, task: remainingTask },
				signal,
			});
			if (signal.aborted) {
				throw new DOMException(
					"B112 calibration simulation cancelled during serial block",
					"AbortError",
				);
			}
			const block = validateB112CalibrationSimulationBlock(scriptedBlock, {
				frozen,
				task,
				blockIndex,
			});
			const blockRequests = blockSimulatedRequests(block);
			if (blockRequests > remainingCampaign || blockRequests > remainingTask) {
				fail(
					"simulation.requestBudget",
					"scripted block crossed a frozen simulated request budget",
				);
			}
			blocks.push(block);
			campaignRequests = addSafe(campaignRequests, blockRequests, "simulation.campaignRequests");
			taskRequests = addSafe(taskRequests, blockRequests, "simulation.taskRequests");
		}
	}
	return strictSnapshot({
		blocks,
		summary: aggregateB112CalibrationSimulation({ frozen, blocks, schedulerBudgetExhausted }),
	});
}
