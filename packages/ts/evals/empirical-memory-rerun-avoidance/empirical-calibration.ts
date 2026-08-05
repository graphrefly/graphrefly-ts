import {
	array,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	fail,
	finiteNumber,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import type {
	EmpiricalCampaignTaskV1,
	EmpiricalTaskQualificationReportV1,
	EmpiricalWarmBranchKind,
	FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import {
	B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM,
	type EmpiricalCalibrationTrialBlockObservationV4,
	type EmpiricalSmokeEvidenceClassV1,
	validateEmpiricalCalibrationTrialBlockObservation,
} from "./empirical-smoke-evidence.js";
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

export const B112_CALIBRATION_TERMINAL_SLOT_SCHEMA =
	"graphrefly.private-solution-eval.empirical-calibration-terminal-slot.v4";
export const B112_CALIBRATION_CAMPAIGN_SCORECARD_SCHEMA =
	"graphrefly.private-solution-eval.empirical-calibration-campaign-scorecard.v4";
export const B112_CALIBRATION_TRIAL_BLOCK_IDENTITY_REVISION =
	"b112-calibration-trial-block-identity.v1";
export const B112_CALIBRATION_BLOCK_PREPARATION_FAILURE_SCHEMA =
	"graphrefly.private-solution-eval.empirical-calibration-block-preparation-failure.v4";
export const B112_CALIBRATION_EMPIRICAL_BLOCK_RESULT_SCHEMA =
	"graphrefly.private-solution-eval.empirical-calibration-block-result.v4";
export const B112_CALIBRATION_AGGREGATE_STOP_AUTHORITY_SCHEMA =
	"graphrefly.private-solution-eval.empirical-calibration-aggregate-stop-authority.v4";

const B112_CALIBRATION_BUDGET_ISSUE_CODES = Object.freeze([
	"agent-output-byte-budget-exhausted",
	"agent-request-budget-exhausted",
	"agent-step-budget-exhausted",
	"calibration-block-budget-exhausted",
	"calibration-budget-exhausted",
	"calibration-campaign-budget-exhausted",
	"calibration-task-budget-exhausted",
	"file-byte-budget-exhausted",
	"model-turn-output-budget-exhausted",
	"model-turn-retry-elapsed-budget-exhausted",
	"replacement-file-byte-budget-exhausted",
	"smoke-budget-exhausted",
	"tool-action-budget-exhausted",
	"tool-result-byte-budget-exhausted",
	"workspace-snapshot-byte-budget-exhausted",
] as const);

type B112CalibrationNotAttemptedIssueCode =
	| "calibration-block-preparation-failed"
	| "calibration-budget-exhausted"
	| "calibration-campaign-budget-exhausted"
	| "calibration-task-budget-exhausted";

export interface B112CalibrationBlockPreparationFailureV4 {
	readonly schemaVersion: typeof B112_CALIBRATION_BLOCK_PREPARATION_FAILURE_SCHEMA;
	readonly trialBlockRef: string;
	readonly trialBlockDigest: string;
	readonly issueCode: "calibration-block-preparation-failed";
}

export interface B112CalibrationTerminalSlotV4 {
	readonly schemaVersion: typeof B112_CALIBRATION_TERMINAL_SLOT_SCHEMA;
	readonly campaignRef: string;
	readonly manifestDigest: string;
	readonly taskRef: string;
	readonly taskDigest: string;
	readonly blockIndex: 1 | 2 | 3;
	readonly blockOrdinal: number;
	readonly status:
		| "observed"
		| "not-attempted-budget-exhausted"
		| "not-attempted-preparation-failed";
	readonly attempted: boolean;
	readonly observation: EmpiricalCalibrationTrialBlockObservationV4 | null;
	readonly observationDigest: string | null;
	readonly aggregateStopAuthority: B112CalibrationAggregateStopAuthorityV4 | null;
	readonly issueCodes: readonly string[];
}

export interface B112CalibrationAggregateStopAuthorityV4 {
	readonly schemaVersion: typeof B112_CALIBRATION_AGGREGATE_STOP_AUTHORITY_SCHEMA;
	readonly scope: "task" | "campaign";
	readonly basis:
		| "observed-requests"
		| "observed-cost"
		| "observed-elapsed"
		| "prospective-cost-reservation";
	readonly observedValue: number;
	readonly limit: number;
	readonly prospectiveValue: number | null;
	readonly admissionRejectionDigest: string | null;
	readonly admissionRejection: B112CalibrationCostAdmissionRejectionV4 | null;
}

export interface B112CalibrationCostAdmissionRejectionV4 {
	readonly schemaVersion: "b112-smoke-admission-rejection.v1";
	readonly requestRef: string;
	readonly reasons: readonly string[];
	readonly requests: number;
	readonly maxRequests: number;
	readonly maxStepsPerRun: number;
	readonly wireRequestBytes: number;
	readonly maxCanonicalRequestBytes: number;
	readonly reservedInputTokens: number;
	readonly prospectiveInputTokens: number;
	readonly maxInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly prospectiveOutputTokens: number;
	readonly maxOutputTokens: number;
	readonly reservedCostMicrousd: number;
	readonly prospectiveCostMicrousd: number;
	readonly maxSmokeSpendMicrousd: number;
}

export interface B112CalibrationEmpiricalTaskResultV4 {
	readonly taskRef: string;
	readonly plannedBlocks: 3;
	readonly attemptedBlocks: number;
	readonly eligibleColdFailures: number;
	readonly evaluablePrimaryPairs: number;
	readonly primaryEffect: number | null;
	readonly incompleteOrNonEvaluableBlocks: number;
}

export interface B112CalibrationCampaignScorecardV4 {
	readonly schemaVersion: typeof B112_CALIBRATION_CAMPAIGN_SCORECARD_SCHEMA;
	readonly campaignRef: string;
	readonly manifestDigest: string;
	readonly profile: "calibration";
	readonly evidenceClass: EmpiricalSmokeEvidenceClassV1 | "not-attempted";
	readonly empiricalLiveEvidence: boolean;
	readonly efficacyClaim: "none";
	readonly claimBoundary: typeof B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM;
	readonly aggregationRevision: string;
	readonly intervalRevision: typeof B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION;
	readonly aggregationSeed: string;
	readonly configurationRef: string;
	readonly configurationDigest: string;
	readonly routeProfileDigest: string | null;
	readonly routeQualificationDigests: readonly string[];
	readonly pricingSourceUrl: string | null;
	readonly pricingRevision: string | null;
	readonly terminalSlotDigests: readonly string[];
	readonly observationDigests: readonly string[];
	readonly plannedBlocks: 15;
	readonly attemptedBlocks: number;
	readonly completeBlocks: number;
	readonly incompleteBlocks: number;
	readonly nonEvaluableBlocks: number;
	readonly eligibleColdFailures: number;
	readonly warmRunsAttempted: number;
	readonly warmRunsEvaluable: number;
	readonly taskResults: readonly B112CalibrationEmpiricalTaskResultV4[];
	readonly primaryComparison: B112CalibrationSimulationComparisonV1;
	readonly secondaryComparisons: readonly B112CalibrationSimulationComparisonV1[];
	readonly requests: number;
	readonly steps: number;
	readonly attempts: number;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly totalTokens: number | null;
	readonly hostInputBytes: number;
	readonly hostOutputBytes: number;
	readonly latencyMs: number;
	readonly costMicrousd: number;
	readonly costBasis: "simulated-contract" | "provider-usage" | "conservative-reservation";
	readonly reservedInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly status: "calibration-complete-exploratory-no-efficacy-claim" | "incomplete";
	readonly issueCodes: readonly string[];
}

export interface B112CalibrationEmpiricalRunInputV4 {
	readonly configurationRef: string;
	readonly configurationDigest: string;
	readonly task: EmpiricalCampaignTaskV1;
	readonly taskDigest: string;
	readonly blockIndex: 1 | 2 | 3;
	readonly blockOrdinal: number;
	readonly trialBlockRef: string;
	readonly trialBlockDigest: string;
	readonly remainingBudget: {
		readonly campaignRequests: number;
		readonly campaignCostMicrousd: number;
		readonly campaignElapsedMs: number;
		readonly taskRequests: number;
		readonly taskCostMicrousd: number;
	};
	readonly signal: AbortSignal;
}

export type B112CalibrationEmpiricalRunnerV4 = (
	input: B112CalibrationEmpiricalRunInputV4,
) => Promise<unknown>;

export type B112CalibrationBudgetExhaustionScopeV4 = "none" | "block" | "task" | "campaign";

export interface B112CalibrationEmpiricalBlockResultV4 {
	readonly schemaVersion: typeof B112_CALIBRATION_EMPIRICAL_BLOCK_RESULT_SCHEMA;
	readonly observation: EmpiricalCalibrationTrialBlockObservationV4;
	readonly budgetExhaustionScope: B112CalibrationBudgetExhaustionScopeV4;
	readonly costAdmissionRejection: B112CalibrationCostAdmissionRejectionV4 | null;
}

const B112_CALIBRATION_ADMISSION_REASONS = Object.freeze([
	"pending-reservation",
	"request-limit",
	"step-limit",
	"canonical-request-bytes",
	"input-token-reservation",
	"output-token-reservation",
	"cost-reservation",
	"elapsed-budget",
] as const);

function validateB112CalibrationCostAdmissionRejection(
	value: unknown,
	path: string,
): B112CalibrationCostAdmissionRejectionV4 {
	const candidate = record(value, path);
	const keys = [
		"maxCanonicalRequestBytes",
		"maxInputTokens",
		"maxOutputTokens",
		"maxRequests",
		"maxSmokeSpendMicrousd",
		"maxStepsPerRun",
		"prospectiveCostMicrousd",
		"prospectiveInputTokens",
		"prospectiveOutputTokens",
		"reasons",
		"requestRef",
		"requests",
		"reservedCostMicrousd",
		"reservedInputTokens",
		"reservedOutputTokens",
		"schemaVersion",
		"wireRequestBytes",
	] as const;
	exactKeys(candidate, keys, path);
	const reasons = canonicalArrayCopy(candidate.reasons, `${path}.reasons`).map((reason, index) =>
		oneOf(reason, B112_CALIBRATION_ADMISSION_REASONS, `${path}.reasons[${index}]`),
	);
	const reasonRanks = reasons.map((reason) => B112_CALIBRATION_ADMISSION_REASONS.indexOf(reason));
	if (
		new Set(reasons).size !== reasons.length ||
		!reasons.includes("cost-reservation") ||
		reasonRanks.some((rank, index) => index > 0 && rank <= (reasonRanks[index - 1] ?? -1))
	) {
		fail(`${path}.reasons`, "requires one unique cost-reservation reason");
	}
	const integer = (key: (typeof keys)[number]) => safeInteger(candidate[key], `${path}.${key}`);
	return strictSnapshot({
		schemaVersion: literal(
			candidate.schemaVersion,
			"b112-smoke-admission-rejection.v1",
			`${path}.schemaVersion`,
		),
		requestRef: coordinate(candidate.requestRef, `${path}.requestRef`),
		reasons: Object.freeze(reasons),
		requests: integer("requests"),
		maxRequests: integer("maxRequests"),
		maxStepsPerRun: integer("maxStepsPerRun"),
		wireRequestBytes: integer("wireRequestBytes"),
		maxCanonicalRequestBytes: integer("maxCanonicalRequestBytes"),
		reservedInputTokens: integer("reservedInputTokens"),
		prospectiveInputTokens: integer("prospectiveInputTokens"),
		maxInputTokens: integer("maxInputTokens"),
		reservedOutputTokens: integer("reservedOutputTokens"),
		prospectiveOutputTokens: integer("prospectiveOutputTokens"),
		maxOutputTokens: integer("maxOutputTokens"),
		reservedCostMicrousd: integer("reservedCostMicrousd"),
		prospectiveCostMicrousd: integer("prospectiveCostMicrousd"),
		maxSmokeSpendMicrousd: integer("maxSmokeSpendMicrousd"),
	});
}

export function createB112CalibrationEmpiricalBlockResult(input: {
	readonly observation: EmpiricalCalibrationTrialBlockObservationV4;
	readonly budgetExhaustionScope: B112CalibrationBudgetExhaustionScopeV4;
	readonly costAdmissionRejection: B112CalibrationCostAdmissionRejectionV4 | null;
}): B112CalibrationEmpiricalBlockResultV4 {
	const observation = validateEmpiricalCalibrationTrialBlockObservation(input.observation);
	if (
		observation.issueCodes.includes("calibration-task-budget-exhausted") ||
		observation.issueCodes.includes("calibration-campaign-budget-exhausted")
	) {
		fail("calibration.blockResult.observation", "cannot supply scheduler-owned aggregate scope");
	}
	const budgetExhaustionScope = oneOf(
		input.budgetExhaustionScope,
		["none", "block", "task", "campaign"],
		"calibration.blockResult.budgetExhaustionScope",
	);
	const hasBudgetExhaustion = hasB112CalibrationBudgetExhaustion(observation.issueCodes);
	if ((budgetExhaustionScope === "none") === hasBudgetExhaustion) {
		fail(
			"calibration.blockResult.budgetExhaustionScope",
			"must classify exactly one observed budget-exhaustion scope",
		);
	}
	const costAdmissionRejection =
		input.costAdmissionRejection === null
			? null
			: validateB112CalibrationCostAdmissionRejection(
					input.costAdmissionRejection,
					"calibration.blockResult.costAdmissionRejection",
				);
	if (
		(budgetExhaustionScope === "none" || budgetExhaustionScope === "block") &&
		costAdmissionRejection
	) {
		fail(
			"calibration.blockResult.costAdmissionRejection",
			"aggregate cost admission requires aggregate scope",
		);
	}
	return strictSnapshot({
		schemaVersion: B112_CALIBRATION_EMPIRICAL_BLOCK_RESULT_SCHEMA,
		observation,
		budgetExhaustionScope,
		costAdmissionRejection,
	});
}

export function validateB112CalibrationEmpiricalBlockResult(
	value: unknown,
): B112CalibrationEmpiricalBlockResultV4 {
	const candidate = record(value, "calibration.blockResult");
	exactKeys(
		candidate,
		["budgetExhaustionScope", "costAdmissionRejection", "observation", "schemaVersion"],
		"calibration.blockResult",
	);
	literal(
		candidate.schemaVersion,
		B112_CALIBRATION_EMPIRICAL_BLOCK_RESULT_SCHEMA,
		"calibration.blockResult.schemaVersion",
	);
	return createB112CalibrationEmpiricalBlockResult({
		observation: candidate.observation as EmpiricalCalibrationTrialBlockObservationV4,
		budgetExhaustionScope:
			candidate.budgetExhaustionScope as B112CalibrationBudgetExhaustionScopeV4,
		costAdmissionRejection:
			candidate.costAdmissionRejection as B112CalibrationCostAdmissionRejectionV4 | null,
	});
}

export function createB112CalibrationBlockPreparationFailure(
	trialBlockRef: string,
	trialBlockDigest: string,
): B112CalibrationBlockPreparationFailureV4 {
	return strictSnapshot({
		schemaVersion: B112_CALIBRATION_BLOCK_PREPARATION_FAILURE_SCHEMA,
		trialBlockRef: coordinate(trialBlockRef, "calibration.blockPreparationFailure.trialBlockRef"),
		trialBlockDigest: string(
			trialBlockDigest,
			"calibration.blockPreparationFailure.trialBlockDigest",
		),
		issueCode: "calibration-block-preparation-failed" as const,
	});
}

function validateB112CalibrationBlockPreparationFailure(
	value: unknown,
	expected: { readonly trialBlockRef: string; readonly trialBlockDigest: string },
): B112CalibrationBlockPreparationFailureV4 {
	const candidate = record(value, "calibration.blockPreparationFailure");
	exactKeys(
		candidate,
		["issueCode", "schemaVersion", "trialBlockDigest", "trialBlockRef"],
		"calibration.blockPreparationFailure",
	);
	literal(
		candidate.schemaVersion,
		B112_CALIBRATION_BLOCK_PREPARATION_FAILURE_SCHEMA,
		"calibration.blockPreparationFailure.schemaVersion",
	);
	literal(
		candidate.issueCode,
		"calibration-block-preparation-failed",
		"calibration.blockPreparationFailure.issueCode",
	);
	const normalized = createB112CalibrationBlockPreparationFailure(
		string(candidate.trialBlockRef, "calibration.blockPreparationFailure.trialBlockRef"),
		string(candidate.trialBlockDigest, "calibration.blockPreparationFailure.trialBlockDigest"),
	);
	if (
		normalized.trialBlockRef !== expected.trialBlockRef ||
		normalized.trialBlockDigest !== expected.trialBlockDigest
	) {
		fail("calibration.blockPreparationFailure", "substituted scheduled trial-block identity");
	}
	return normalized;
}

function isB112CalibrationBlockPreparationFailureCandidate(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, "schemaVersion");
	return (
		descriptor !== undefined &&
		!("get" in descriptor) &&
		!("set" in descriptor) &&
		descriptor.value === B112_CALIBRATION_BLOCK_PREPARATION_FAILURE_SCHEMA
	);
}

function hasB112CalibrationBudgetExhaustion(issueCodes: readonly string[]): boolean {
	return issueCodes.some((issueCode) =>
		(B112_CALIBRATION_BUDGET_ISSUE_CODES as readonly string[]).includes(issueCode),
	);
}

function deriveB112CalibrationAggregateStopAuthority(input: {
	readonly scope: B112CalibrationBudgetExhaustionScopeV4;
	readonly observation: EmpiricalCalibrationTrialBlockObservationV4;
	readonly remainingBudget: B112CalibrationEmpiricalRunInputV4["remainingBudget"];
	readonly costAdmissionRejection: B112CalibrationCostAdmissionRejectionV4 | null;
}): B112CalibrationAggregateStopAuthorityV4 | null {
	if (input.scope === "none" || input.scope === "block") return null;
	const result = input.observation.result;
	const remaining = input.remainingBudget;
	const campaignCrossing =
		result.requests >= remaining.campaignRequests ||
		result.costMicrousd >= remaining.campaignCostMicrousd ||
		result.latencyMs >= remaining.campaignElapsedMs;
	if (input.scope === "task" && campaignCrossing) {
		fail("calibration.aggregateStopAuthority", "task scope cannot supersede campaign exhaustion");
	}
	const candidates =
		input.scope === "campaign"
			? ([
					["observed-requests", result.requests, remaining.campaignRequests],
					["observed-cost", result.costMicrousd, remaining.campaignCostMicrousd],
					["observed-elapsed", result.latencyMs, remaining.campaignElapsedMs],
				] as const)
			: ([
					["observed-requests", result.requests, remaining.taskRequests],
					["observed-cost", result.costMicrousd, remaining.taskCostMicrousd],
				] as const);
	for (const [basis, observedValue, limit] of candidates) {
		if (observedValue >= limit) {
			return strictSnapshot({
				schemaVersion: B112_CALIBRATION_AGGREGATE_STOP_AUTHORITY_SCHEMA,
				scope: input.scope,
				basis,
				observedValue,
				limit,
				prospectiveValue: null,
				admissionRejectionDigest: null,
				admissionRejection: null,
			});
		}
	}
	const costAdmissionRejection = input.costAdmissionRejection;
	const selectedCostLimit =
		input.scope === "campaign" ? remaining.campaignCostMicrousd : remaining.taskCostMicrousd;
	const selectedAggregateOwnsMinimum =
		input.scope === "campaign"
			? remaining.campaignCostMicrousd <= remaining.taskCostMicrousd &&
				remaining.campaignCostMicrousd <= input.observation.route.maxSmokeSpendMicrousd
			: remaining.taskCostMicrousd < remaining.campaignCostMicrousd &&
				remaining.taskCostMicrousd <= input.observation.route.maxSmokeSpendMicrousd;
	if (
		costAdmissionRejection === null ||
		!selectedAggregateOwnsMinimum ||
		costAdmissionRejection.maxSmokeSpendMicrousd !== selectedCostLimit ||
		costAdmissionRejection.prospectiveCostMicrousd <= selectedCostLimit
	) {
		fail(
			"calibration.aggregateStopAuthority",
			"aggregate scope lacks matching totals or prospective cost admission",
		);
	}
	return strictSnapshot({
		schemaVersion: B112_CALIBRATION_AGGREGATE_STOP_AUTHORITY_SCHEMA,
		scope: input.scope,
		basis: "prospective-cost-reservation" as const,
		observedValue: result.costMicrousd,
		limit: selectedCostLimit,
		prospectiveValue: costAdmissionRejection.prospectiveCostMicrousd,
		admissionRejectionDigest: empiricalStrictJsonDigest(costAdmissionRejection),
		admissionRejection: costAdmissionRejection,
	});
}

export function createB112CalibrationTrialBlockIdentity(
	frozen: FrozenEmpiricalCampaignManifestV1,
	taskRef: string,
	blockIndex: 1 | 2 | 3,
): { readonly trialBlockRef: string; readonly trialBlockDigest: string } {
	if (
		frozen.manifest.trialPlan.profile !== "calibration" ||
		!frozen.manifest.trialPlan.activeTaskRefs.includes(taskRef)
	) {
		fail("calibration.trialBlockIdentity", "requires one frozen active calibration task");
	}
	const identity = strictSnapshot({
		revision: B112_CALIBRATION_TRIAL_BLOCK_IDENTITY_REVISION,
		campaignRef: frozen.manifest.campaignRef,
		manifestDigest: frozen.manifestDigest,
		taskRef,
		blockIndex: safeInteger(blockIndex, "calibration.blockIndex", { min: 1, max: 3 }),
	});
	const trialBlockDigest = empiricalStrictJsonDigest(identity);
	return Object.freeze({
		trialBlockRef: `b112-calibration:${trialBlockDigest.slice("sha256:".length)}`,
		trialBlockDigest,
	});
}

function calibrationSlot(
	frozen: FrozenEmpiricalCampaignManifestV1,
	task: EmpiricalCampaignTaskV1,
	blockIndex: 1 | 2 | 3,
	blockOrdinal: number,
	observationValue: EmpiricalCalibrationTrialBlockObservationV4 | null,
	notAttemptedIssueCode: B112CalibrationNotAttemptedIssueCode = "calibration-budget-exhausted",
	aggregateStopAuthority: B112CalibrationAggregateStopAuthorityV4 | null = null,
): B112CalibrationTerminalSlotV4 {
	const taskDigest = empiricalStrictJsonDigest(task);
	if (observationValue === null) {
		return strictSnapshot({
			schemaVersion: B112_CALIBRATION_TERMINAL_SLOT_SCHEMA,
			campaignRef: frozen.manifest.campaignRef,
			manifestDigest: frozen.manifestDigest,
			taskRef: task.taskRef,
			taskDigest,
			blockIndex,
			blockOrdinal,
			status:
				notAttemptedIssueCode === "calibration-block-preparation-failed"
					? ("not-attempted-preparation-failed" as const)
					: ("not-attempted-budget-exhausted" as const),
			attempted: false,
			observation: null,
			observationDigest: null,
			aggregateStopAuthority: null,
			issueCodes: [notAttemptedIssueCode],
		});
	}
	const observation = validateEmpiricalCalibrationTrialBlockObservation(observationValue);
	if (
		observation.issueCodes.includes("calibration-task-budget-exhausted") ||
		observation.issueCodes.includes("calibration-campaign-budget-exhausted")
	) {
		fail("calibration.observation", "cannot supply scheduler-owned aggregate scope");
	}
	const expectedTrialBlock = createB112CalibrationTrialBlockIdentity(
		frozen,
		task.taskRef,
		blockIndex,
	);
	if (
		observation.campaignRef !== frozen.manifest.campaignRef ||
		observation.manifestDigest !== frozen.manifestDigest ||
		observation.taskRef !== task.taskRef ||
		observation.taskDigest !== taskDigest ||
		observation.blockIndex !== blockIndex ||
		observation.trialBlockRef !== expectedTrialBlock.trialBlockRef ||
		observation.trialBlockDigest !== expectedTrialBlock.trialBlockDigest
	) {
		fail("calibration.observation", "does not match its exact scheduled task block");
	}
	return strictSnapshot({
		schemaVersion: B112_CALIBRATION_TERMINAL_SLOT_SCHEMA,
		campaignRef: frozen.manifest.campaignRef,
		manifestDigest: frozen.manifestDigest,
		taskRef: task.taskRef,
		taskDigest,
		blockIndex,
		blockOrdinal,
		status: "observed" as const,
		attempted: true,
		observation,
		observationDigest: empiricalStrictJsonDigest(observation),
		aggregateStopAuthority,
		issueCodes:
			aggregateStopAuthority === null
				? observation.issueCodes
				: Object.freeze(
						[
							...observation.issueCodes,
							aggregateStopAuthority.scope === "campaign"
								? "calibration-campaign-budget-exhausted"
								: "calibration-task-budget-exhausted",
						].sort(),
					),
	});
}

function validateB112CalibrationTerminalSlotsForFrozen(
	frozen: FrozenEmpiricalCampaignManifestV1,
	value: unknown,
): readonly B112CalibrationTerminalSlotV4[] {
	if (
		frozen.manifest.trialPlan.profile !== "calibration" ||
		frozen.manifest.trialPlan.activeTaskRefs.length !== 5 ||
		frozen.manifest.trialPlan.attemptedColdBlocksPerTask !== 3
	) {
		fail("calibration.trialPlan", "requires the exact five-task by three-block calibration plan");
	}
	const values = canonicalArrayCopy(value, "calibration.terminalSlots");
	if (values.length !== MAX_CALIBRATION_BLOCKS) {
		fail("calibration.terminalSlots", "requires all fifteen planned terminal slots");
	}
	const slots: B112CalibrationTerminalSlotV4[] = [];
	let ordinal = 0;
	let campaignRequests = 0;
	let campaignCostMicrousd = 0;
	let campaignElapsedMs = 0;
	let campaignStopIssueCode:
		| "calibration-block-preparation-failed"
		| "calibration-campaign-budget-exhausted"
		| null = null;
	for (const taskRef of frozen.manifest.trialPlan.activeTaskRefs) {
		const task = frozen.manifest.catalog.tasks.find((candidate) => candidate.taskRef === taskRef);
		if (task === undefined) fail("calibration.taskRef", "missing frozen calibration task");
		let taskRequests = 0;
		let taskCostMicrousd = 0;
		let taskStopIssueCode: "calibration-task-budget-exhausted" | null = null;
		for (const blockIndex of [1, 2, 3] as const) {
			ordinal += 1;
			const candidate = record(values[ordinal - 1], `calibration.terminalSlots[${ordinal - 1}]`);
			exactKeys(
				candidate,
				[
					"aggregateStopAuthority",
					"attempted",
					"blockIndex",
					"blockOrdinal",
					"campaignRef",
					"issueCodes",
					"manifestDigest",
					"observation",
					"observationDigest",
					"schemaVersion",
					"status",
					"taskDigest",
					"taskRef",
				],
				`calibration.terminalSlots[${ordinal - 1}]`,
			);
			literal(
				candidate.schemaVersion,
				B112_CALIBRATION_TERMINAL_SLOT_SCHEMA,
				`calibration.terminalSlots[${ordinal - 1}].schemaVersion`,
			);
			literal(
				candidate.blockOrdinal,
				ordinal,
				`calibration.terminalSlots[${ordinal - 1}].blockOrdinal`,
			);
			const status = oneOf(
				candidate.status,
				["observed", "not-attempted-budget-exhausted", "not-attempted-preparation-failed"],
				`calibration.terminalSlots[${ordinal - 1}].status`,
			);
			const observation =
				status === "observed"
					? validateEmpiricalCalibrationTrialBlockObservation(candidate.observation)
					: null;
			let aggregateStopAuthority: B112CalibrationAggregateStopAuthorityV4 | null = null;
			if (status === "observed" && candidate.aggregateStopAuthority !== null) {
				if (observation === null) fail("calibration.terminalSlots", "missing observation");
				const authority = record(
					candidate.aggregateStopAuthority,
					`calibration.terminalSlots[${ordinal - 1}].aggregateStopAuthority`,
				);
				exactKeys(
					authority,
					[
						"admissionRejection",
						"admissionRejectionDigest",
						"basis",
						"limit",
						"observedValue",
						"prospectiveValue",
						"schemaVersion",
						"scope",
					],
					`calibration.terminalSlots[${ordinal - 1}].aggregateStopAuthority`,
				);
				literal(
					authority.schemaVersion,
					B112_CALIBRATION_AGGREGATE_STOP_AUTHORITY_SCHEMA,
					"calibration.aggregateStopAuthority.schemaVersion",
				);
				const scope = oneOf(
					authority.scope,
					["task", "campaign"],
					"calibration.aggregateStopAuthority.scope",
				);
				const basis = oneOf(
					authority.basis,
					[
						"observed-requests",
						"observed-cost",
						"observed-elapsed",
						"prospective-cost-reservation",
					],
					"calibration.aggregateStopAuthority.basis",
				);
				safeInteger(authority.limit, "calibration.aggregateStopAuthority.limit");
				const prospectiveValue =
					authority.prospectiveValue === null
						? null
						: safeInteger(
								authority.prospectiveValue,
								"calibration.aggregateStopAuthority.prospectiveValue",
							);
				const admissionRejectionDigest =
					authority.admissionRejectionDigest === null
						? null
						: digest(
								authority.admissionRejectionDigest,
								"calibration.aggregateStopAuthority.admissionRejectionDigest",
							);
				const admissionRejection =
					authority.admissionRejection === null
						? null
						: validateB112CalibrationCostAdmissionRejection(
								authority.admissionRejection,
								"calibration.aggregateStopAuthority.admissionRejection",
							);
				if (
					(admissionRejection === null) !== (admissionRejectionDigest === null) ||
					(admissionRejection !== null &&
						empiricalStrictJsonDigest(admissionRejection) !== admissionRejectionDigest)
				) {
					fail("calibration.aggregateStopAuthority", "rejection record digest mismatch");
				}
				aggregateStopAuthority = deriveB112CalibrationAggregateStopAuthority({
					scope,
					observation,
					remainingBudget: {
						campaignRequests: frozen.manifest.budgets.campaign.maxRequests - campaignRequests,
						campaignCostMicrousd:
							frozen.manifest.budgets.campaign.maxCostMicrousd - campaignCostMicrousd,
						campaignElapsedMs: frozen.manifest.budgets.campaign.maxElapsedMs - campaignElapsedMs,
						taskRequests: frozen.manifest.budgets.taskModel.maxRequests - taskRequests,
						taskCostMicrousd: frozen.manifest.budgets.taskModel.maxCostMicrousd - taskCostMicrousd,
					},
					costAdmissionRejection:
						basis === "prospective-cost-reservation" && prospectiveValue !== null
							? (admissionRejection ??
								fail(
									"calibration.aggregateStopAuthority.admissionRejection",
									"prospective authority requires rejection record",
								))
							: null,
				});
				if (
					empiricalStrictJsonDigest(authority) !== empiricalStrictJsonDigest(aggregateStopAuthority)
				) {
					fail("calibration.aggregateStopAuthority", "is non-canonical or substituted");
				}
			}
			const normalized = calibrationSlot(
				frozen,
				task,
				blockIndex,
				ordinal,
				observation,
				status === "not-attempted-preparation-failed"
					? "calibration-block-preparation-failed"
					: status === "not-attempted-budget-exhausted"
						? (oneOf(
								canonicalArrayCopy(candidate.issueCodes, "calibration.terminalSlot.issueCodes")[0],
								[
									"calibration-budget-exhausted",
									"calibration-campaign-budget-exhausted",
									"calibration-task-budget-exhausted",
								],
								"calibration.terminalSlot.issueCode",
							) as B112CalibrationNotAttemptedIssueCode)
						: "calibration-budget-exhausted",
				aggregateStopAuthority,
			);
			if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(normalized)) {
				fail("calibration.terminalSlots", "contains a non-canonical or substituted slot");
			}
			const expectedStopIssueCode = campaignStopIssueCode ?? taskStopIssueCode;
			if (expectedStopIssueCode !== null) {
				const expectedStatus =
					expectedStopIssueCode === "calibration-block-preparation-failed"
						? "not-attempted-preparation-failed"
						: "not-attempted-budget-exhausted";
				if (
					normalized.status !== expectedStatus ||
					normalized.issueCodes.length !== 1 ||
					normalized.issueCodes[0] !== expectedStopIssueCode
				) {
					fail("calibration.terminalSlots", "violates the frozen aggregate stop suffix");
				}
			} else if (normalized.status === "not-attempted-preparation-failed") {
				campaignStopIssueCode = "calibration-block-preparation-failed";
			} else if (normalized.status !== "observed") {
				fail("calibration.terminalSlots", "budget stop has no preceding scheduler authority");
			} else {
				const result = normalized.observation?.result;
				if (result === undefined) fail("calibration.terminalSlots", "observed slot lacks result");
				campaignRequests = addSafe(
					campaignRequests,
					result.requests,
					"calibration.terminalSlots.campaignRequests",
				);
				campaignCostMicrousd = addSafe(
					campaignCostMicrousd,
					result.costMicrousd,
					"calibration.terminalSlots.campaignCostMicrousd",
				);
				campaignElapsedMs = addSafe(
					campaignElapsedMs,
					result.latencyMs,
					"calibration.terminalSlots.campaignElapsedMs",
				);
				taskRequests = addSafe(
					taskRequests,
					result.requests,
					"calibration.terminalSlots.taskRequests",
				);
				taskCostMicrousd = addSafe(
					taskCostMicrousd,
					result.costMicrousd,
					"calibration.terminalSlots.taskCostMicrousd",
				);
				const campaignBudget = frozen.manifest.budgets.campaign;
				const taskBudget = frozen.manifest.budgets.taskModel;
				if (
					campaignRequests >= campaignBudget.maxRequests ||
					campaignCostMicrousd >= campaignBudget.maxCostMicrousd ||
					campaignElapsedMs >= campaignBudget.maxElapsedMs ||
					aggregateStopAuthority?.scope === "campaign"
				) {
					campaignStopIssueCode = "calibration-campaign-budget-exhausted";
				} else if (
					taskRequests >= taskBudget.maxRequests ||
					taskCostMicrousd >= taskBudget.maxCostMicrousd ||
					aggregateStopAuthority?.scope === "task"
				) {
					taskStopIssueCode = "calibration-task-budget-exhausted";
				}
			}
			slots.push(normalized);
		}
	}
	const observations = slots.flatMap((slot) =>
		slot.observation === null ? [] : [slot.observation],
	);
	if (
		new Set(observations.map((observation) => observation.trialBlockRef)).size !==
			observations.length ||
		new Set(observations.map((observation) => observation.trialBlockDigest)).size !==
			observations.length
	) {
		fail("calibration.terminalSlots", "contains duplicate empirical trial-block identity");
	}
	return Object.freeze(slots);
}

export function validateB112CalibrationTerminalSlots(
	frozenValue: FrozenEmpiricalCampaignManifestV1,
	qualificationReport: EmpiricalTaskQualificationReportV1,
	value: unknown,
): readonly B112CalibrationTerminalSlotV4[] {
	const frozen = validateFrozenEmpiricalCampaignManifest(frozenValue, qualificationReport);
	return validateB112CalibrationTerminalSlotsForFrozen(frozen, value);
}

function empiricalComparison(
	observations: readonly EmpiricalCalibrationTrialBlockObservationV4[],
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
		for (const observation of observations) {
			if (observation.taskRef !== taskRef || !observation.rerunEligible) continue;
			const relevant = observation.warmBranches.find(
				(branch) => branch.branchKind === "relevant-applied",
			);
			const control = observation.warmBranches.find(
				(branch) => branch.branchKind === controlBranchKind,
			);
			const relevantEvaluable =
				relevant?.run !== null && relevant?.run.classification !== "non-evaluable";
			const controlEvaluable =
				control?.run !== null && control?.run.classification !== "non-evaluable";
			if (!relevantEvaluable || !controlEvaluable) continue;
			const relevantPass = relevant?.run?.verifierStatus === "passed" ? 1 : 0;
			const controlPass = control?.run?.verifierStatus === "passed" ? 1 : 0;
			differences.push(relevantPass - controlPass);
			evaluablePairs += 1;
			if (relevantPass === 1 && controlPass === 0) relevantOnly += 1;
			else if (relevantPass === 0 && controlPass === 1) controlOnly += 1;
			else if (relevantPass === 1) concordantPass += 1;
			else concordantFail += 1;
		}
		if (differences.length > 0) {
			taskEffects.push(
				normalizeZero(
					differences.reduce((total, difference) => total + difference, 0) / differences.length,
				),
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

export function createB112CalibrationCampaignScorecard(
	frozenValue: FrozenEmpiricalCampaignManifestV1,
	qualificationReport: EmpiricalTaskQualificationReportV1,
	terminalSlotsValue: readonly B112CalibrationTerminalSlotV4[],
): B112CalibrationCampaignScorecardV4 {
	const frozen = validateFrozenEmpiricalCampaignManifest(frozenValue, qualificationReport);
	return createB112CalibrationCampaignScorecardForFrozen(frozen, terminalSlotsValue);
}

function calibrationRouteProfileDigest(
	route: EmpiricalCalibrationTrialBlockObservationV4["route"],
): string {
	const {
		qualificationRef: _qualificationRef,
		qualificationRevision: _qualificationRevision,
		qualificationDigest: _qualificationDigest,
		...stableRouteProfile
	} = route;
	return empiricalStrictJsonDigest(stableRouteProfile);
}

function createB112CalibrationCampaignScorecardForFrozen(
	frozen: FrozenEmpiricalCampaignManifestV1,
	terminalSlotsValue: readonly B112CalibrationTerminalSlotV4[],
): B112CalibrationCampaignScorecardV4 {
	const trialPlan = frozen.manifest.trialPlan;
	if (trialPlan.profile !== "calibration")
		fail("calibration.profile", "requires calibration manifest");
	if (
		frozen.manifest.aggregation.intervalRevision !== B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION
	) {
		fail("calibration.intervalRevision", "does not select the D676 exhaustive interval");
	}
	const slots = validateB112CalibrationTerminalSlotsForFrozen(frozen, terminalSlotsValue);
	const observations = slots.flatMap((slot) =>
		slot.observation === null ? [] : [slot.observation],
	);
	const actorConfigurations = frozen.manifest.modelConfigurations.filter(
		(configuration) => configuration.role === "actor",
	);
	if (actorConfigurations.length !== 1) fail("calibration.configuration", "expected one actor");
	const actorConfiguration = actorConfigurations[0] as (typeof actorConfigurations)[number];
	const configurationDigest = empiricalStrictJsonDigest(actorConfiguration);
	const first = observations[0] ?? null;
	const routeProfileDigest = first === null ? null : calibrationRouteProfileDigest(first.route);
	const simulated = first?.executionClass === "simulated-contract";
	if (
		first !== null &&
		observations.some(
			(observation) =>
				(observation.executionClass === "simulated-contract") !== simulated ||
				observation.route.configurationRef !== actorConfiguration.configurationRef ||
				observation.route.configurationDigest !== configurationDigest ||
				calibrationRouteProfileDigest(observation.route) !== routeProfileDigest,
		)
	) {
		fail("calibration.observations", "must share one frozen configuration and route profile");
	}
	const routeQualificationDigests = observations.map(
		(observation) => observation.route.qualificationDigest,
	);
	if (new Set(routeQualificationDigests).size !== routeQualificationDigests.length) {
		fail("calibration.observations", "requires one distinct qualification per observed block");
	}
	const empiricalLiveEvidence = observations.some(
		(observation) => observation.executionClass === "live-provider",
	);
	const evidenceClass: EmpiricalSmokeEvidenceClassV1 | "not-attempted" =
		first === null
			? "not-attempted"
			: simulated
				? "simulated-contract"
				: empiricalLiveEvidence
					? "live-provider"
					: "live-approved-no-provider-evidence";
	const sum = (
		field:
			| "requests"
			| "steps"
			| "attempts"
			| "hostInputBytes"
			| "hostOutputBytes"
			| "latencyMs"
			| "costMicrousd"
			| "reservedInputTokens"
			| "reservedOutputTokens",
	) =>
		observations.reduce(
			(total, observation) => addSafe(total, observation.result[field], `calibration.${field}`),
			0,
		);
	const sumNullable = (field: "inputTokens" | "outputTokens" | "totalTokens") =>
		observations.some((observation) => observation.result[field] === null)
			? null
			: observations.reduce(
					(total, observation) =>
						addSafe(total, observation.result[field] as number, `calibration.${field}`),
					0,
				);
	const taskResults = trialPlan.activeTaskRefs.map((taskRef) => {
		const taskObservations = observations.filter((observation) => observation.taskRef === taskRef);
		const primary = empiricalComparison(taskObservations, [taskRef], "proposal-only");
		return strictSnapshot({
			taskRef,
			plannedBlocks: 3 as const,
			attemptedBlocks: taskObservations.length,
			eligibleColdFailures: taskObservations.filter((observation) => observation.rerunEligible)
				.length,
			evaluablePrimaryPairs: primary.evaluablePairs,
			primaryEffect: primary.pointEstimate,
			incompleteOrNonEvaluableBlocks:
				3 -
				taskObservations.filter((observation) => observation.result.classification === "complete")
					.length,
		});
	});
	const issueList = slots.flatMap((slot) => slot.issueCodes);
	const uniqueIssues = [...new Set(issueList)].sort();
	if (uniqueIssues.length > MAX_ISSUE_CODES) fail("calibration.issueCodes", "too many issues");
	const costBases = new Set(observations.map((observation) => observation.result.costBasis));
	const costBasis =
		observations.length > 0 && costBases.size === 1
			? (observations[0] as EmpiricalCalibrationTrialBlockObservationV4).result.costBasis
			: ("conservative-reservation" as const);
	return strictSnapshot({
		schemaVersion: B112_CALIBRATION_CAMPAIGN_SCORECARD_SCHEMA,
		campaignRef: frozen.manifest.campaignRef,
		manifestDigest: frozen.manifestDigest,
		profile: "calibration" as const,
		evidenceClass,
		empiricalLiveEvidence,
		efficacyClaim: "none" as const,
		claimBoundary: B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM,
		aggregationRevision: frozen.manifest.aggregation.aggregationRevision,
		intervalRevision: B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION,
		aggregationSeed: frozen.manifest.aggregation.aggregationSeed,
		configurationRef: actorConfiguration.configurationRef,
		configurationDigest,
		routeProfileDigest,
		routeQualificationDigests,
		pricingSourceUrl: first?.route.pricingSourceUrl ?? null,
		pricingRevision: first?.route.pricingRevision ?? null,
		terminalSlotDigests: slots.map(empiricalStrictJsonDigest),
		observationDigests: observations.map(empiricalStrictJsonDigest),
		plannedBlocks: MAX_CALIBRATION_BLOCKS as 15,
		attemptedBlocks: observations.length,
		completeBlocks: observations.filter(
			(observation) => observation.result.classification === "complete",
		).length,
		incompleteBlocks:
			slots.filter((slot) => slot.status !== "observed").length +
			observations.filter((observation) => observation.result.classification === "incomplete")
				.length,
		nonEvaluableBlocks: observations.filter(
			(observation) => observation.result.classification === "non-evaluable",
		).length,
		eligibleColdFailures: observations.filter((observation) => observation.rerunEligible).length,
		warmRunsAttempted: observations.reduce(
			(total, observation) =>
				addSafe(total, observation.result.warmRunsAttempted, "calibration.warmRunsAttempted"),
			0,
		),
		warmRunsEvaluable: observations.reduce(
			(total, observation) =>
				addSafe(
					total,
					observation.warmBranches.filter(
						(branch) => branch.run !== null && branch.run.classification !== "non-evaluable",
					).length,
					"calibration.warmRunsEvaluable",
				),
			0,
		),
		taskResults,
		primaryComparison: empiricalComparison(observations, trialPlan.activeTaskRefs, "proposal-only"),
		secondaryComparisons: SECONDARY_BRANCH_KINDS.map((branchKind) =>
			empiricalComparison(observations, trialPlan.activeTaskRefs, branchKind),
		),
		requests: sum("requests"),
		steps: sum("steps"),
		attempts: sum("attempts"),
		inputTokens: sumNullable("inputTokens"),
		outputTokens: sumNullable("outputTokens"),
		totalTokens: sumNullable("totalTokens"),
		hostInputBytes: sum("hostInputBytes"),
		hostOutputBytes: sum("hostOutputBytes"),
		latencyMs: sum("latencyMs"),
		costMicrousd: sum("costMicrousd"),
		costBasis,
		reservedInputTokens: sum("reservedInputTokens"),
		reservedOutputTokens: sum("reservedOutputTokens"),
		status:
			observations.length === MAX_CALIBRATION_BLOCKS &&
			observations.every((observation) => observation.result.classification !== "incomplete") &&
			!uniqueIssues.includes("calibration-block-preparation-failed") &&
			!hasB112CalibrationBudgetExhaustion(uniqueIssues)
				? ("calibration-complete-exploratory-no-efficacy-claim" as const)
				: ("incomplete" as const),
		issueCodes: uniqueIssues,
	});
}

export async function runB112EmpiricalCalibration(input: {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly runEmpiricalBlock: B112CalibrationEmpiricalRunnerV4;
	readonly signal: AbortSignal;
}): Promise<{
	readonly terminalSlots: readonly B112CalibrationTerminalSlotV4[];
	readonly scorecard: B112CalibrationCampaignScorecardV4;
}> {
	const request = record(input, "calibration.runnerInput");
	exactKeys(
		request,
		["frozen", "qualificationReport", "runEmpiricalBlock", "signal"],
		"calibration.runnerInput",
	);
	const runEmpiricalBlock = request.runEmpiricalBlock;
	const signal = request.signal;
	if (typeof runEmpiricalBlock !== "function") {
		fail("calibration.runEmpiricalBlock", "expected function capability");
	}
	if (!(signal instanceof AbortSignal)) fail("calibration.signal", "expected AbortSignal");
	const qualificationReport = request.qualificationReport as EmpiricalTaskQualificationReportV1;
	const frozen = validateFrozenEmpiricalCampaignManifest(
		request.frozen as FrozenEmpiricalCampaignManifestV1,
		qualificationReport,
	);
	const trialPlan = frozen.manifest.trialPlan;
	if (trialPlan.profile !== "calibration")
		fail("calibration.profile", "requires calibration manifest");
	if (
		frozen.manifest.aggregation.intervalRevision !== B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION
	) {
		fail("calibration.intervalRevision", "does not select the D676 exhaustive interval");
	}
	const actors = frozen.manifest.modelConfigurations.filter(
		(configuration) => configuration.role === "actor",
	);
	if (actors.length !== 1) fail("calibration.configuration", "expected exactly one actor");
	const actor = actors[0] as (typeof actors)[number];
	const configurationDigest = empiricalStrictJsonDigest(actor);
	const slots: B112CalibrationTerminalSlotV4[] = [];
	let campaignRequests = 0;
	let campaignCostMicrousd = 0;
	let campaignElapsedMs = 0;
	let ordinal = 0;
	let campaignStopIssueCode: B112CalibrationNotAttemptedIssueCode | null = null;
	for (const taskRef of trialPlan.activeTaskRefs) {
		const task = frozen.manifest.catalog.tasks.find((candidate) => candidate.taskRef === taskRef);
		if (task === undefined) fail("calibration.taskRef", "missing frozen calibration task");
		const taskDigest = empiricalStrictJsonDigest(task);
		let taskRequests = 0;
		let taskCostMicrousd = 0;
		let taskStopIssueCode: B112CalibrationNotAttemptedIssueCode | null = null;
		for (const blockIndex of [1, 2, 3] as const) {
			ordinal += 1;
			if (signal.aborted) {
				throw new DOMException(
					"B112 empirical calibration cancelled between serial blocks",
					"AbortError",
				);
			}
			const campaignBudget = frozen.manifest.budgets.campaign;
			const taskBudget = frozen.manifest.budgets.taskModel;
			if (campaignStopIssueCode === null) {
				if (
					campaignRequests >= campaignBudget.maxRequests ||
					campaignCostMicrousd >= campaignBudget.maxCostMicrousd ||
					campaignElapsedMs >= campaignBudget.maxElapsedMs
				) {
					campaignStopIssueCode = "calibration-campaign-budget-exhausted";
				} else if (
					taskRequests >= taskBudget.maxRequests ||
					taskCostMicrousd >= taskBudget.maxCostMicrousd
				) {
					taskStopIssueCode = "calibration-task-budget-exhausted";
				}
			}
			const stopIssueCode = campaignStopIssueCode ?? taskStopIssueCode;
			if (stopIssueCode !== null) {
				slots.push(calibrationSlot(frozen, task, blockIndex, ordinal, null, stopIssueCode));
				continue;
			}
			const trialBlock = createB112CalibrationTrialBlockIdentity(frozen, task.taskRef, blockIndex);
			const remainingBudget = strictSnapshot({
				campaignRequests: campaignBudget.maxRequests - campaignRequests,
				campaignCostMicrousd: campaignBudget.maxCostMicrousd - campaignCostMicrousd,
				campaignElapsedMs: campaignBudget.maxElapsedMs - campaignElapsedMs,
				taskRequests: taskBudget.maxRequests - taskRequests,
				taskCostMicrousd: taskBudget.maxCostMicrousd - taskCostMicrousd,
			});
			const rawResult = await (runEmpiricalBlock as B112CalibrationEmpiricalRunnerV4)({
				configurationRef: actor.configurationRef,
				configurationDigest,
				task,
				taskDigest,
				blockIndex,
				blockOrdinal: ordinal,
				...trialBlock,
				remainingBudget,
				signal,
			});
			if (signal.aborted) {
				throw new DOMException(
					"B112 empirical calibration cancelled during serial block",
					"AbortError",
				);
			}
			if (isB112CalibrationBlockPreparationFailureCandidate(rawResult)) {
				validateB112CalibrationBlockPreparationFailure(rawResult, trialBlock);
				campaignStopIssueCode = "calibration-block-preparation-failed";
				slots.push(calibrationSlot(frozen, task, blockIndex, ordinal, null, campaignStopIssueCode));
				continue;
			}
			const blockResult = validateB112CalibrationEmpiricalBlockResult(rawResult);
			const observation = blockResult.observation;
			const result = observation.result;
			const crossedCampaignBudget =
				result.requests > campaignBudget.maxRequests - campaignRequests ||
				result.costMicrousd > campaignBudget.maxCostMicrousd - campaignCostMicrousd ||
				result.latencyMs > campaignBudget.maxElapsedMs - campaignElapsedMs;
			const crossedTaskBudget =
				result.requests > taskBudget.maxRequests - taskRequests ||
				result.costMicrousd > taskBudget.maxCostMicrousd - taskCostMicrousd;
			if (crossedCampaignBudget && blockResult.budgetExhaustionScope !== "campaign") {
				fail("calibration.budget", "campaign crossing requires campaign-scoped exhaustion");
			}
			if (
				!crossedCampaignBudget &&
				crossedTaskBudget &&
				blockResult.budgetExhaustionScope !== "task" &&
				blockResult.budgetExhaustionScope !== "campaign"
			) {
				fail("calibration.budget", "task crossing requires task-scoped exhaustion");
			}
			const aggregateStopAuthority = deriveB112CalibrationAggregateStopAuthority({
				scope: blockResult.budgetExhaustionScope,
				observation,
				remainingBudget,
				costAdmissionRejection: blockResult.costAdmissionRejection,
			});
			slots.push(
				calibrationSlot(
					frozen,
					task,
					blockIndex,
					ordinal,
					observation,
					"calibration-budget-exhausted",
					aggregateStopAuthority,
				),
			);
			campaignRequests = addSafe(campaignRequests, result.requests, "calibration.campaignRequests");
			campaignCostMicrousd = addSafe(
				campaignCostMicrousd,
				result.costMicrousd,
				"calibration.campaignCostMicrousd",
			);
			campaignElapsedMs = addSafe(
				campaignElapsedMs,
				result.latencyMs,
				"calibration.campaignElapsedMs",
			);
			taskRequests = addSafe(taskRequests, result.requests, "calibration.taskRequests");
			taskCostMicrousd = addSafe(
				taskCostMicrousd,
				result.costMicrousd,
				"calibration.taskCostMicrousd",
			);
			if (crossedCampaignBudget || blockResult.budgetExhaustionScope === "campaign") {
				campaignStopIssueCode = "calibration-campaign-budget-exhausted";
			} else if (crossedTaskBudget || blockResult.budgetExhaustionScope === "task") {
				taskStopIssueCode = "calibration-task-budget-exhausted";
			}
		}
	}
	const terminalSlots = validateB112CalibrationTerminalSlotsForFrozen(frozen, slots);
	return strictSnapshot({
		terminalSlots,
		scorecard: createB112CalibrationCampaignScorecardForFrozen(frozen, terminalSlots),
	});
}
