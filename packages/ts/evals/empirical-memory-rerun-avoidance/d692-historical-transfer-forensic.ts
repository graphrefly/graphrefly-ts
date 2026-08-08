import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	boolean,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	CLOSED_ACTOR_TOOL_REFS,
	classifyClosedHostStructuredTerminal,
} from "./closed-task-profile-host.js";
import {
	D691_BUDGET,
	D691_PRIVATE_PERSISTENCE_ROOT,
	type D691HistoricalTransferObservationV1,
	validateD691Observation,
} from "./d691-historical-transfer-live.js";
import type { EmpiricalSmokeRunObservationV3 } from "./empirical-smoke-evidence.js";
import {
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D692_HISTORICAL_TRANSFER_FORENSIC_VERSION =
	"graphrefly.private-solution-eval.historical-transfer-forensic.v1" as const;
export const D692_SCRIPTED_COUNTERFACTUAL_VERSION =
	"graphrefly.private-solution-eval.d692-scripted-counterfactual.v1" as const;
export const D692_HISTORICAL_TRANSFER_FORENSIC_SCORECARD_VERSION =
	"graphrefly.private-solution-eval.d692-historical-transfer-forensic-scorecard.v1" as const;
export const D692_HISTORICAL_TRANSFER_FORENSIC_GENERATION_VERSION =
	"graphrefly.private-solution-eval.d692-historical-transfer-forensic-generation.v1" as const;
export const D692_AUTHORITY_REF = "decision.D692" as const;
export const D692_AUTHORITY_REVISION = "decision.D692.2026-08-08.v1" as const;
export const D692_CLAIM_BOUNDARY =
	"derived-historical-transfer-forensic-no-causal-or-efficacy-claim" as const;
export const D692_QUALIFIED_D691_LIVE_OBSERVATION_DIGEST =
	"sha256:67e7a27a00c034a1567987190ebc43b51ca4ba538604c15ce60fe698ba3db5f2" as const;
export const D692_D691_PRIVATE_HOST_SOURCE_DIGEST =
	"sha256:1ecb3e6f3aca640fa5dc13b954dc4c87bf44bba212c6bdb220dc0ad4d5fd0207" as const;
export const D692_QUALIFIED_FORENSIC_DIGEST =
	"sha256:0c1cd895b9d36624b13b27d90ebf609c81944c2e8d9c4aa11643742924b26d47" as const;
export const D692_QUALIFIED_SCORECARD_DIGEST =
	"sha256:e970a072eea14dfca11df6f1985c00a7d7de559d8977b1e15e77dab7a0b4755e" as const;
export const D692_PRIVATE_GENERATION_REF =
	"d692-historical-transfer-forensic-2026-08-08-v1" as const;
export const D692_PRIVATE_PERSISTENCE_ROOT = D691_PRIVATE_PERSISTENCE_ROOT;

const D692_ARM_ORDER = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);
type D692ArmKind = (typeof D692_ARM_ORDER)[number];

const D692_TERMINAL_LIFECYCLE = "inspection-only-structured-output" as const;
const D692_CURRENT_DISPOSITION = "accepted-then-hidden-verifier-failed" as const;
const D692_CANDIDATE_DISPOSITION = "rejected-before-hidden-verifier" as const;

export interface D692ActionCountsV1 {
	readonly readFile: number;
	readonly searchLiteral: number;
	readonly replaceExact: number;
	readonly workspaceDiff: number;
	readonly runCommand: number;
	readonly total: number;
}

export const D692_INSPECTION_ACTION_COUNTS: D692ActionCountsV1 = Object.freeze({
	readFile: 4,
	searchLiteral: 0,
	replaceExact: 0,
	workspaceDiff: 0,
	runCommand: 0,
	total: 4,
});

export interface D692ArmForensicV1 {
	readonly armKind: D692ArmKind;
	readonly terminalLifecycle: typeof D692_TERMINAL_LIFECYCLE;
	readonly terminalEvidence: "hidden-verifier-entry-requires-structured-output";
	readonly turns: 2;
	readonly requests: 2;
	readonly attempts: 2;
	readonly actionCounts: D692ActionCountsV1;
	readonly actionIntentSetDigest: string;
	readonly actionResultSetDigest: string;
	readonly actionOrderDigest: string;
	readonly memoryDelivered: boolean;
	readonly actionsBoundToDeliveredMemory: boolean;
	readonly workspaceChanged: false;
	readonly verifierStatus: "failed";
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly latencyMs: number;
	readonly costMicrousd: number;
}

export interface D692ScriptedCounterfactualV1 {
	readonly schemaVersion: typeof D692_SCRIPTED_COUNTERFACTUAL_VERSION;
	readonly contractModelOnly: true;
	readonly sourceTerminalLifecycle: typeof D692_TERMINAL_LIFECYCLE;
	readonly currentGenericHostDisposition: typeof D692_CURRENT_DISPOSITION;
	readonly candidateProgressGateDisposition: typeof D692_CANDIDATE_DISPOSITION;
	readonly currentHiddenVerifierRuns: true;
	readonly candidateHiddenVerifierRuns: false;
	readonly scriptedTraceDigest: string;
	readonly currentTransitionDigest: string;
	readonly candidateTransitionDigest: string;
	readonly providerCallCount: 0;
	readonly networkCallCount: 0;
	readonly chargedCostMicrousd: 0;
	readonly counterfactualDigest: string;
}

export interface D692HistoricalTransferForensicV1 {
	readonly schemaVersion: typeof D692_HISTORICAL_TRANSFER_FORENSIC_VERSION;
	readonly authorityRef: typeof D692_AUTHORITY_REF;
	readonly authorityRevision: typeof D692_AUTHORITY_REVISION;
	readonly claimBoundary: typeof D692_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly sourceObservationDigest: typeof D692_QUALIFIED_D691_LIVE_OBSERVATION_DIGEST;
	readonly actorCapabilitySourceDigest: typeof D692_D691_PRIVATE_HOST_SOURCE_DIGEST;
	readonly arms: readonly D692ArmForensicV1[];
	readonly allActionIntentSetsEqual: true;
	readonly allActionResultSetsEqual: true;
	readonly distinctActionOrderCount: number;
	readonly relevantVsProposalDelta: {
		readonly inputTokens: number;
		readonly outputTokens: number;
		readonly latencyMs: number;
		readonly costMicrousd: number;
	};
	readonly budgetHeadroom: {
		readonly requests: number;
		readonly steps: number;
		readonly actions: number;
		readonly inputTokens: number;
		readonly outputTokens: number;
		readonly costMicrousd: number;
		readonly recordedModelLatencyMs: number;
		readonly aggregateElapsedHeadroomUpperBoundMs: number;
		readonly aggregateElapsedHeadroomExact: false;
	};
	readonly actorCapability: {
		readonly actorVisibleCommandClass: "repository-status-only";
		readonly actorVisibleReadFiles: true;
		readonly actorVisibleExactMutation: true;
		readonly actorVisibleWorkspaceDiff: true;
		readonly actorVisibleFocusedVerifier: false;
		readonly actorVisibleBroaderSuite: false;
		readonly hiddenVerifierOwnedByHost: true;
	};
	readonly memoryActionability: {
		readonly status: "validation-strategy-not-actor-executable";
		readonly instructions: readonly {
			readonly instruction:
				| "exercise-producer-canonical-consumer-path"
				| "reject-contradicted-local-shorthand"
				| "run-focused-verifier"
				| "run-broader-suite";
			readonly actorExecutable: false;
			readonly issueCode:
				| "producer-consumer-exercise-command-not-visible"
				| "negative-shorthand-check-command-not-visible"
				| "focused-verifier-not-actor-visible"
				| "broader-suite-not-actor-visible";
		}[];
	};
	readonly counterfactual: D692ScriptedCounterfactualV1;
	readonly forensicDigest: string;
}

export interface D692HistoricalTransferForensicScorecardV1 {
	readonly schemaVersion: typeof D692_HISTORICAL_TRANSFER_FORENSIC_SCORECARD_VERSION;
	readonly claimBoundary: typeof D692_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly forensicDigests: readonly [string];
	readonly counterfactualDigest: string;
	readonly attemptedArms: 6;
	readonly inspectionOnlyArms: 6;
	readonly mutationArms: 0;
	readonly memoryBoundArms: 1;
	readonly status: "complete-inspection-only-finalization";
	readonly scorecardDigest: string;
}

export interface PersistedD692PrivateGenerationV1 {
	readonly generationRef: string;
	readonly forensicDigest: string;
	readonly counterfactualDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}

function compareBinary(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function exactDigestSet(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort(compareBinary);
}

export function runD692ScriptedTerminal(input: {
	readonly policy: "current-generic-host" | "candidate-progress-gate";
	readonly terminalLifecycle: typeof D692_TERMINAL_LIFECYCLE;
	readonly actionCounts: D692ActionCountsV1;
	readonly hiddenVerifier: () => "failed";
}): {
	readonly disposition: typeof D692_CURRENT_DISPOSITION | typeof D692_CANDIDATE_DISPOSITION;
	readonly hiddenVerifierRuns: 0 | 1;
	readonly transitionDigest: string;
} {
	if (input.terminalLifecycle !== D692_TERMINAL_LIFECYCLE) {
		throw new TypeError("D692 scripted counterfactual requires the frozen premature-final trace");
	}
	const requireObjectiveProgress = input.policy === "candidate-progress-gate";
	const productionTransition = classifyClosedHostStructuredTerminal({
		finishReason: "structured-output",
		structuredOutputPresent: true,
		requireObjectiveProgress,
		mutationObserved: input.actionCounts.replaceExact > 0,
		diffObserved: input.actionCounts.workspaceDiff > 0,
		commandObserved: input.actionCounts.runCommand > 0,
	});
	if (productionTransition === "reject-structured-output-before-verifier") {
		const material = strictSnapshot({
			policy: input.policy,
			terminalLifecycle: input.terminalLifecycle,
			productionTransition,
			disposition: D692_CANDIDATE_DISPOSITION,
			hiddenVerifierRuns: 0 as const,
		});
		return Object.freeze({
			disposition: D692_CANDIDATE_DISPOSITION,
			hiddenVerifierRuns: 0,
			transitionDigest: empiricalStrictJsonDigest(material),
		});
	}
	if (input.hiddenVerifier() !== "failed") {
		throw new TypeError("D692 scripted current-host verifier must reproduce the frozen failure");
	}
	const material = strictSnapshot({
		policy: input.policy,
		terminalLifecycle: input.terminalLifecycle,
		productionTransition,
		disposition: D692_CURRENT_DISPOSITION,
		hiddenVerifierRuns: 1 as const,
	});
	return Object.freeze({
		disposition: D692_CURRENT_DISPOSITION,
		hiddenVerifierRuns: 1,
		transitionDigest: empiricalStrictJsonDigest(material),
	});
}

export function createD692ScriptedCounterfactual(
	actionCounts: D692ActionCountsV1,
): D692ScriptedCounterfactualV1 {
	const scriptedTrace = strictSnapshot({
		terminalLifecycle: D692_TERMINAL_LIFECYCLE,
		actionCounts,
	});
	const current = runD692ScriptedTerminal({
		policy: "current-generic-host",
		...scriptedTrace,
		hiddenVerifier: () => "failed",
	});
	const candidate = runD692ScriptedTerminal({
		policy: "candidate-progress-gate",
		...scriptedTrace,
		hiddenVerifier: () => {
			throw new TypeError("candidate D692 progress gate invoked the hidden verifier");
		},
	});
	if (current.hiddenVerifierRuns !== 1 || candidate.hiddenVerifierRuns !== 0) {
		throw new TypeError("D692 scripted counterfactual verifier invocation counts drifted");
	}
	const material = strictSnapshot({
		schemaVersion: D692_SCRIPTED_COUNTERFACTUAL_VERSION,
		contractModelOnly: true as const,
		sourceTerminalLifecycle: D692_TERMINAL_LIFECYCLE,
		currentGenericHostDisposition: current.disposition as typeof D692_CURRENT_DISPOSITION,
		candidateProgressGateDisposition: candidate.disposition as typeof D692_CANDIDATE_DISPOSITION,
		currentHiddenVerifierRuns: true as const,
		candidateHiddenVerifierRuns: false as const,
		scriptedTraceDigest: empiricalStrictJsonDigest(scriptedTrace),
		currentTransitionDigest: current.transitionDigest,
		candidateTransitionDigest: candidate.transitionDigest,
		providerCallCount: 0 as const,
		networkCallCount: 0 as const,
		chargedCostMicrousd: 0 as const,
	});
	return strictSnapshot({
		...material,
		counterfactualDigest: empiricalStrictJsonDigest(material),
	});
}

function actionCounts(run: EmpiricalSmokeRunObservationV3): D692ActionCountsV1 {
	const counts = {
		readFile: 0,
		searchLiteral: 0,
		replaceExact: 0,
		workspaceDiff: 0,
		runCommand: 0,
	};
	for (const action of run.actionTrace) {
		switch (action.toolRef) {
			case CLOSED_ACTOR_TOOL_REFS.readFile:
				counts.readFile += 1;
				break;
			case CLOSED_ACTOR_TOOL_REFS.searchLiteral:
				counts.searchLiteral += 1;
				break;
			case CLOSED_ACTOR_TOOL_REFS.replaceExact:
				counts.replaceExact += 1;
				break;
			case CLOSED_ACTOR_TOOL_REFS.workspaceDiff:
				counts.workspaceDiff += 1;
				break;
			case CLOSED_ACTOR_TOOL_REFS.runCommand:
				counts.runCommand += 1;
				break;
			default:
				throw new TypeError("D692 encountered a non-allowlisted action type");
		}
	}
	return Object.freeze({ ...counts, total: run.actionTrace.length });
}

function deriveArm(armKind: D692ArmKind, run: EmpiricalSmokeRunObservationV3): D692ArmForensicV1 {
	const counts = actionCounts(run);
	if (
		run.turnRequestDigests.length !== 2 ||
		run.steps !== 2 ||
		run.requests !== 2 ||
		run.attempts !== 2 ||
		run.attemptTrace.length !== 2 ||
		run.attemptTrace.some(
			(attempt, index) =>
				attempt.stepIndex !== index ||
				attempt.attemptOrdinal !== 1 ||
				attempt.status !== "completed" ||
				attempt.requests !== 1 ||
				attempt.issueCodes.length !== 0,
		) ||
		counts.readFile !== 4 ||
		counts.total !== 4 ||
		run.actionTrace.some((action) => action.stepIndex !== 0) ||
		run.classification !== "incomplete" ||
		run.verifierStatus !== "failed" ||
		run.workspaceChanged !== false ||
		run.issueCodes.length !== 1 ||
		run.issueCodes[0] !== "d691-target-verifier-failed" ||
		run.inputTokens === null ||
		run.outputTokens === null
	) {
		throw new TypeError("D692 source arm is not the frozen inspection-only structured-final trace");
	}
	const memoryDelivered = run.memoryContextRecordDigest !== null;
	const actionsBoundToDeliveredMemory =
		memoryDelivered &&
		run.actionTrace.every(
			(action) => action.memoryContextRecordDigest === run.memoryContextRecordDigest,
		);
	return strictSnapshot({
		armKind,
		terminalLifecycle: D692_TERMINAL_LIFECYCLE,
		terminalEvidence: "hidden-verifier-entry-requires-structured-output" as const,
		turns: 2 as const,
		requests: 2 as const,
		attempts: 2 as const,
		actionCounts: counts,
		actionIntentSetDigest: empiricalStrictJsonDigest(
			exactDigestSet(run.actionTrace.map((action) => action.intentDigest)),
		),
		actionResultSetDigest: empiricalStrictJsonDigest(
			exactDigestSet(run.actionTrace.map((action) => action.resultDigest)),
		),
		actionOrderDigest: empiricalStrictJsonDigest(
			run.actionTrace.map((action) => action.intentDigest),
		),
		memoryDelivered,
		actionsBoundToDeliveredMemory,
		workspaceChanged: false as const,
		verifierStatus: "failed" as const,
		inputTokens: run.inputTokens,
		outputTokens: run.outputTokens,
		latencyMs: run.latencyMs,
		costMicrousd: run.costMicrousd,
	});
}

export function createD692HistoricalTransferForensic(input: {
	readonly observation: D691HistoricalTransferObservationV1;
	readonly actorCapabilitySourceBytes: Uint8Array;
}): D692HistoricalTransferForensicV1 {
	const request = record(input, "d692.forensic.input");
	exactKeys(request, ["actorCapabilitySourceBytes", "observation"], "d692.forensic.input");
	if (
		!(request.actorCapabilitySourceBytes instanceof Uint8Array) ||
		request.actorCapabilitySourceBytes.byteLength === 0 ||
		request.actorCapabilitySourceBytes.byteLength > 262_144
	) {
		throw new TypeError("D692 requires bounded reviewed D691 host source bytes");
	}
	const actorCapabilitySourceBytes = Uint8Array.from(request.actorCapabilitySourceBytes);
	const actorCapabilitySourceDigest = empiricalSha256(actorCapabilitySourceBytes);
	if (actorCapabilitySourceDigest !== D692_D691_PRIVATE_HOST_SOURCE_DIGEST) {
		throw new TypeError("D692 actor capability source does not match the reviewed D691 host bytes");
	}
	const observation = validateD691Observation(
		request.observation as D691HistoricalTransferObservationV1,
	);
	if (
		observation.executionClass !== "live-provider" ||
		observation.observationDigest !== D692_QUALIFIED_D691_LIVE_OBSERVATION_DIGEST
	) {
		throw new TypeError("D692 requires the exact qualified D691 live observation");
	}
	const warmRuns = observation.underlying.warmBranches.map((branch, index) => {
		const expectedKind = D692_ARM_ORDER[index + 1];
		if (
			expectedKind === undefined ||
			branch.branchKind !== expectedKind ||
			!branch.attempted ||
			branch.run === null
		) {
			throw new TypeError("D692 requires all five frozen warm arms in canonical order");
		}
		return deriveArm(expectedKind, branch.run);
	});
	const arms = strictSnapshot([deriveArm("cold", observation.underlying.cold), ...warmRuns]);
	const intentSetDigests = new Set(arms.map((arm) => arm.actionIntentSetDigest));
	const resultSetDigests = new Set(arms.map((arm) => arm.actionResultSetDigest));
	if (intentSetDigests.size !== 1 || resultSetDigests.size !== 1) {
		throw new TypeError("D692 exact live arms do not share identical action/result sets");
	}
	const relevant = arms[1];
	const proposal = arms[2];
	if (
		relevant?.armKind !== "relevant-applied" ||
		proposal?.armKind !== "proposal-only" ||
		!relevant.memoryDelivered ||
		!relevant.actionsBoundToDeliveredMemory ||
		arms.filter((arm) => arm.memoryDelivered).length !== 1
	) {
		throw new TypeError("D692 live memory delivery/action binding no longer matches D691");
	}
	const result = observation.underlying.result;
	const totalActions = arms.reduce((total, arm) => total + arm.actionCounts.total, 0);
	const material = strictSnapshot({
		schemaVersion: D692_HISTORICAL_TRANSFER_FORENSIC_VERSION,
		authorityRef: D692_AUTHORITY_REF,
		authorityRevision: D692_AUTHORITY_REVISION,
		claimBoundary: D692_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		sourceObservationDigest: D692_QUALIFIED_D691_LIVE_OBSERVATION_DIGEST,
		actorCapabilitySourceDigest: D692_D691_PRIVATE_HOST_SOURCE_DIGEST,
		arms,
		allActionIntentSetsEqual: true as const,
		allActionResultSetsEqual: true as const,
		distinctActionOrderCount: new Set(arms.map((arm) => arm.actionOrderDigest)).size,
		relevantVsProposalDelta: {
			inputTokens: relevant.inputTokens - proposal.inputTokens,
			outputTokens: relevant.outputTokens - proposal.outputTokens,
			latencyMs: relevant.latencyMs - proposal.latencyMs,
			costMicrousd: relevant.costMicrousd - proposal.costMicrousd,
		},
		budgetHeadroom: {
			requests: D691_BUDGET.maxHttpAttempts - result.requests,
			steps: D691_BUDGET.maxStepsPerRun * arms.length - result.steps,
			actions: D691_BUDGET.maxActionsPerRun * arms.length - totalActions,
			inputTokens: D691_BUDGET.maxInputTokens - (result.inputTokens ?? 0),
			outputTokens: D691_BUDGET.maxOutputTokens - (result.outputTokens ?? 0),
			costMicrousd: D691_BUDGET.maxSpendMicrousd - result.costMicrousd,
			recordedModelLatencyMs: result.latencyMs,
			aggregateElapsedHeadroomUpperBoundMs: D691_BUDGET.maxElapsedMs - result.latencyMs,
			aggregateElapsedHeadroomExact: false as const,
		},
		actorCapability: {
			actorVisibleCommandClass: "repository-status-only" as const,
			actorVisibleReadFiles: true as const,
			actorVisibleExactMutation: true as const,
			actorVisibleWorkspaceDiff: true as const,
			actorVisibleFocusedVerifier: false as const,
			actorVisibleBroaderSuite: false as const,
			hiddenVerifierOwnedByHost: true as const,
		},
		memoryActionability: {
			status: "validation-strategy-not-actor-executable" as const,
			instructions: [
				{
					instruction: "exercise-producer-canonical-consumer-path" as const,
					actorExecutable: false as const,
					issueCode: "producer-consumer-exercise-command-not-visible" as const,
				},
				{
					instruction: "reject-contradicted-local-shorthand" as const,
					actorExecutable: false as const,
					issueCode: "negative-shorthand-check-command-not-visible" as const,
				},
				{
					instruction: "run-focused-verifier" as const,
					actorExecutable: false as const,
					issueCode: "focused-verifier-not-actor-visible" as const,
				},
				{
					instruction: "run-broader-suite" as const,
					actorExecutable: false as const,
					issueCode: "broader-suite-not-actor-visible" as const,
				},
			],
		},
		counterfactual: createD692ScriptedCounterfactual((arms[0] as D692ArmForensicV1).actionCounts),
	});
	return validateD692HistoricalTransferForensic({
		...material,
		forensicDigest: empiricalStrictJsonDigest(material),
	});
}

function validateActionCounts(value: unknown, path: string): D692ActionCountsV1 {
	const counts = record(value, path);
	exactKeys(
		counts,
		["readFile", "replaceExact", "runCommand", "searchLiteral", "total", "workspaceDiff"],
		path,
	);
	const result = strictSnapshot({
		readFile: safeInteger(counts.readFile, `${path}.readFile`, { min: 0, max: 256 }),
		searchLiteral: safeInteger(counts.searchLiteral, `${path}.searchLiteral`, { min: 0, max: 256 }),
		replaceExact: safeInteger(counts.replaceExact, `${path}.replaceExact`, { min: 0, max: 256 }),
		workspaceDiff: safeInteger(counts.workspaceDiff, `${path}.workspaceDiff`, {
			min: 0,
			max: 256,
		}),
		runCommand: safeInteger(counts.runCommand, `${path}.runCommand`, { min: 0, max: 256 }),
		total: safeInteger(counts.total, `${path}.total`, { min: 0, max: 256 }),
	});
	if (
		result.total !==
		result.readFile +
			result.searchLiteral +
			result.replaceExact +
			result.workspaceDiff +
			result.runCommand
	) {
		throw new TypeError(`${path} total does not match its allowlisted action counts`);
	}
	return result;
}

function validateD692Arm(value: unknown, index: number): D692ArmForensicV1 {
	const path = `d692.forensic.arms[${index}]`;
	const arm = record(value, path);
	exactKeys(
		arm,
		[
			"actionCounts",
			"actionIntentSetDigest",
			"actionOrderDigest",
			"actionResultSetDigest",
			"actionsBoundToDeliveredMemory",
			"armKind",
			"attempts",
			"costMicrousd",
			"inputTokens",
			"latencyMs",
			"memoryDelivered",
			"outputTokens",
			"requests",
			"terminalEvidence",
			"terminalLifecycle",
			"turns",
			"verifierStatus",
			"workspaceChanged",
		],
		path,
	);
	const expectedKind = D692_ARM_ORDER[index];
	if (expectedKind === undefined) throw new TypeError("D692 has too many forensic arms");
	const counts = validateActionCounts(arm.actionCounts, `${path}.actionCounts`);
	if (
		counts.readFile !== 4 ||
		counts.total !== 4 ||
		counts.searchLiteral !== 0 ||
		counts.replaceExact !== 0 ||
		counts.workspaceDiff !== 0 ||
		counts.runCommand !== 0
	) {
		throw new TypeError(`${path} is not inspection-only`);
	}
	return strictSnapshot({
		armKind: literal(arm.armKind, expectedKind, `${path}.armKind`),
		terminalLifecycle: literal(
			arm.terminalLifecycle,
			D692_TERMINAL_LIFECYCLE,
			`${path}.terminalLifecycle`,
		),
		terminalEvidence: literal(
			arm.terminalEvidence,
			"hidden-verifier-entry-requires-structured-output",
			`${path}.terminalEvidence`,
		),
		turns: literal(arm.turns, 2, `${path}.turns`),
		requests: literal(arm.requests, 2, `${path}.requests`),
		attempts: literal(arm.attempts, 2, `${path}.attempts`),
		actionCounts: counts,
		actionIntentSetDigest: digest(arm.actionIntentSetDigest, `${path}.actionIntentSetDigest`),
		actionResultSetDigest: digest(arm.actionResultSetDigest, `${path}.actionResultSetDigest`),
		actionOrderDigest: digest(arm.actionOrderDigest, `${path}.actionOrderDigest`),
		memoryDelivered: boolean(arm.memoryDelivered, `${path}.memoryDelivered`),
		actionsBoundToDeliveredMemory: boolean(
			arm.actionsBoundToDeliveredMemory,
			`${path}.actionsBoundToDeliveredMemory`,
		),
		workspaceChanged: literal(arm.workspaceChanged, false, `${path}.workspaceChanged`),
		verifierStatus: literal(arm.verifierStatus, "failed", `${path}.verifierStatus`),
		inputTokens: safeInteger(arm.inputTokens, `${path}.inputTokens`),
		outputTokens: safeInteger(arm.outputTokens, `${path}.outputTokens`),
		latencyMs: safeInteger(arm.latencyMs, `${path}.latencyMs`),
		costMicrousd: safeInteger(arm.costMicrousd, `${path}.costMicrousd`),
	});
}

function validateD692Counterfactual(value: unknown): D692ScriptedCounterfactualV1 {
	const candidate = record(value, "d692.counterfactual");
	exactKeys(
		candidate,
		[
			"candidateHiddenVerifierRuns",
			"candidateProgressGateDisposition",
			"candidateTransitionDigest",
			"chargedCostMicrousd",
			"contractModelOnly",
			"counterfactualDigest",
			"currentGenericHostDisposition",
			"currentHiddenVerifierRuns",
			"currentTransitionDigest",
			"networkCallCount",
			"providerCallCount",
			"schemaVersion",
			"scriptedTraceDigest",
			"sourceTerminalLifecycle",
		],
		"d692.counterfactual",
	);
	const { counterfactualDigest: ignored, ...material } = candidate;
	const counterfactualDigest = digest(ignored, "d692.counterfactual.counterfactualDigest");
	if (empiricalStrictJsonDigest(material) !== counterfactualDigest) {
		throw new TypeError("D692 counterfactual digest does not bind its canonical material");
	}
	const expected = createD692ScriptedCounterfactual(D692_INSPECTION_ACTION_COUNTS);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(expected)) {
		throw new TypeError("D692 counterfactual drifted from its frozen contract model");
	}
	return expected;
}

export function validateD692HistoricalTransferForensic(
	value: unknown,
): D692HistoricalTransferForensicV1 {
	const candidate = record(value, "d692.forensic");
	exactKeys(
		candidate,
		[
			"actorCapability",
			"actorCapabilitySourceDigest",
			"allActionIntentSetsEqual",
			"allActionResultSetsEqual",
			"arms",
			"authorityRef",
			"authorityRevision",
			"budgetHeadroom",
			"causalAttribution",
			"claimBoundary",
			"counterfactual",
			"distinctActionOrderCount",
			"efficacyClaim",
			"forensicDigest",
			"memoryActionability",
			"relevantVsProposalDelta",
			"schemaVersion",
			"sourceObservationDigest",
		],
		"d692.forensic",
	);
	literal(candidate.schemaVersion, D692_HISTORICAL_TRANSFER_FORENSIC_VERSION, "d692.schema");
	literal(candidate.authorityRef, D692_AUTHORITY_REF, "d692.authorityRef");
	literal(candidate.authorityRevision, D692_AUTHORITY_REVISION, "d692.authorityRevision");
	literal(candidate.claimBoundary, D692_CLAIM_BOUNDARY, "d692.claimBoundary");
	literal(candidate.causalAttribution, "undetermined", "d692.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d692.efficacyClaim");
	literal(
		candidate.sourceObservationDigest,
		D692_QUALIFIED_D691_LIVE_OBSERVATION_DIGEST,
		"d692.sourceObservationDigest",
	);
	literal(
		candidate.actorCapabilitySourceDigest,
		D692_D691_PRIVATE_HOST_SOURCE_DIGEST,
		"d692.actorCapabilitySourceDigest",
	);
	const armValues = array(candidate.arms, "d692.arms");
	if (armValues.length !== D692_ARM_ORDER.length)
		throw new TypeError("D692 requires exactly six arms");
	const arms = strictSnapshot(armValues.map((arm, index) => validateD692Arm(arm, index)));
	literal(candidate.allActionIntentSetsEqual, true, "d692.allActionIntentSetsEqual");
	literal(candidate.allActionResultSetsEqual, true, "d692.allActionResultSetsEqual");
	if (
		new Set(arms.map((arm) => arm.actionIntentSetDigest)).size !== 1 ||
		new Set(arms.map((arm) => arm.actionResultSetDigest)).size !== 1
	) {
		throw new TypeError("D692 arm set equality claim is not supported by its digests");
	}
	const distinctActionOrderCount = safeInteger(
		candidate.distinctActionOrderCount,
		"d692.distinctActionOrderCount",
		{ min: 1, max: 6 },
	);
	if (distinctActionOrderCount !== new Set(arms.map((arm) => arm.actionOrderDigest)).size) {
		throw new TypeError("D692 distinct action-order count drifted");
	}
	const delta = record(candidate.relevantVsProposalDelta, "d692.relevantVsProposalDelta");
	exactKeys(
		delta,
		["costMicrousd", "inputTokens", "latencyMs", "outputTokens"],
		"d692.relevantVsProposalDelta",
	);
	const relevant = arms[1] as D692ArmForensicV1;
	const proposal = arms[2] as D692ArmForensicV1;
	const expectedDelta = {
		inputTokens: relevant.inputTokens - proposal.inputTokens,
		outputTokens: relevant.outputTokens - proposal.outputTokens,
		latencyMs: relevant.latencyMs - proposal.latencyMs,
		costMicrousd: relevant.costMicrousd - proposal.costMicrousd,
	};
	for (const key of Object.keys(expectedDelta) as (keyof typeof expectedDelta)[]) {
		literal(delta[key], expectedDelta[key], `d692.relevantVsProposalDelta.${key}`);
	}
	const headroom = record(candidate.budgetHeadroom, "d692.budgetHeadroom");
	exactKeys(
		headroom,
		[
			"actions",
			"aggregateElapsedHeadroomExact",
			"aggregateElapsedHeadroomUpperBoundMs",
			"costMicrousd",
			"inputTokens",
			"outputTokens",
			"recordedModelLatencyMs",
			"requests",
			"steps",
		],
		"d692.budgetHeadroom",
	);
	const sums = (
		key: "requests" | "turns" | "inputTokens" | "outputTokens" | "latencyMs" | "costMicrousd",
	) => arms.reduce((total, arm) => total + arm[key], 0);
	const expectedHeadroom = {
		requests: D691_BUDGET.maxHttpAttempts - sums("requests"),
		steps: D691_BUDGET.maxStepsPerRun * arms.length - sums("turns"),
		actions:
			D691_BUDGET.maxActionsPerRun * arms.length -
			arms.reduce((total, arm) => total + arm.actionCounts.total, 0),
		inputTokens: D691_BUDGET.maxInputTokens - sums("inputTokens"),
		outputTokens: D691_BUDGET.maxOutputTokens - sums("outputTokens"),
		costMicrousd: D691_BUDGET.maxSpendMicrousd - sums("costMicrousd"),
		recordedModelLatencyMs: sums("latencyMs"),
		aggregateElapsedHeadroomUpperBoundMs: D691_BUDGET.maxElapsedMs - sums("latencyMs"),
		aggregateElapsedHeadroomExact: false as const,
	};
	for (const key of Object.keys(expectedHeadroom) as (keyof typeof expectedHeadroom)[]) {
		literal(headroom[key], expectedHeadroom[key], `d692.budgetHeadroom.${key}`);
	}
	const actorCapability = record(candidate.actorCapability, "d692.actorCapability");
	exactKeys(
		actorCapability,
		[
			"actorVisibleBroaderSuite",
			"actorVisibleCommandClass",
			"actorVisibleExactMutation",
			"actorVisibleFocusedVerifier",
			"actorVisibleReadFiles",
			"actorVisibleWorkspaceDiff",
			"hiddenVerifierOwnedByHost",
		],
		"d692.actorCapability",
	);
	literal(
		actorCapability.actorVisibleCommandClass,
		"repository-status-only",
		"d692.actorCapability.actorVisibleCommandClass",
	);
	literal(
		actorCapability.actorVisibleReadFiles,
		true,
		"d692.actorCapability.actorVisibleReadFiles",
	);
	literal(
		actorCapability.actorVisibleExactMutation,
		true,
		"d692.actorCapability.actorVisibleExactMutation",
	);
	literal(
		actorCapability.actorVisibleWorkspaceDiff,
		true,
		"d692.actorCapability.actorVisibleWorkspaceDiff",
	);
	literal(
		actorCapability.actorVisibleFocusedVerifier,
		false,
		"d692.actorCapability.actorVisibleFocusedVerifier",
	);
	literal(
		actorCapability.actorVisibleBroaderSuite,
		false,
		"d692.actorCapability.actorVisibleBroaderSuite",
	);
	literal(
		actorCapability.hiddenVerifierOwnedByHost,
		true,
		"d692.actorCapability.hiddenVerifierOwnedByHost",
	);
	const actionability = record(candidate.memoryActionability, "d692.memoryActionability");
	exactKeys(actionability, ["instructions", "status"], "d692.memoryActionability");
	literal(
		actionability.status,
		"validation-strategy-not-actor-executable",
		"d692.memoryActionability.status",
	);
	const instructionValues = array(
		actionability.instructions,
		"d692.memoryActionability.instructions",
	);
	const expectedInstructions = [
		["exercise-producer-canonical-consumer-path", "producer-consumer-exercise-command-not-visible"],
		["reject-contradicted-local-shorthand", "negative-shorthand-check-command-not-visible"],
		["run-focused-verifier", "focused-verifier-not-actor-visible"],
		["run-broader-suite", "broader-suite-not-actor-visible"],
	] as const;
	if (instructionValues.length !== expectedInstructions.length) {
		throw new TypeError("D692 memory actionability must account for every validation instruction");
	}
	for (const [index, expected] of expectedInstructions.entries()) {
		const instruction = record(
			instructionValues[index],
			`d692.memoryActionability.instructions[${index}]`,
		);
		exactKeys(
			instruction,
			["actorExecutable", "instruction", "issueCode"],
			`d692.memoryActionability.instructions[${index}]`,
		);
		literal(
			instruction.instruction,
			expected[0],
			`d692.memoryActionability.instructions[${index}].instruction`,
		);
		literal(
			instruction.actorExecutable,
			false,
			`d692.memoryActionability.instructions[${index}].actorExecutable`,
		);
		literal(
			instruction.issueCode,
			expected[1],
			`d692.memoryActionability.instructions[${index}].issueCode`,
		);
	}
	validateD692Counterfactual(candidate.counterfactual);
	const forensicDigest = digest(candidate.forensicDigest, "d692.forensicDigest");
	const { forensicDigest: ignored, ...material } = candidate;
	if (ignored !== forensicDigest || empiricalStrictJsonDigest(material) !== forensicDigest) {
		throw new TypeError("D692 forensic digest does not bind its canonical material");
	}
	if (forensicDigest !== D692_QUALIFIED_FORENSIC_DIGEST) {
		throw new TypeError("D692 forensic bytes drifted from the exact qualified report");
	}
	return strictSnapshot(candidate) as unknown as D692HistoricalTransferForensicV1;
}

export function createD692HistoricalTransferForensicScorecard(
	forensic: D692HistoricalTransferForensicV1,
): D692HistoricalTransferForensicScorecardV1 {
	const validated = validateD692HistoricalTransferForensic(forensic);
	const material = strictSnapshot({
		schemaVersion: D692_HISTORICAL_TRANSFER_FORENSIC_SCORECARD_VERSION,
		claimBoundary: D692_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		forensicDigests: [validated.forensicDigest] as const,
		counterfactualDigest: validated.counterfactual.counterfactualDigest,
		attemptedArms: 6 as const,
		inspectionOnlyArms: 6 as const,
		mutationArms: 0 as const,
		memoryBoundArms: 1 as const,
		status: "complete-inspection-only-finalization" as const,
	});
	const scorecard = strictSnapshot({
		...material,
		scorecardDigest: empiricalStrictJsonDigest(material),
	});
	if (scorecard.scorecardDigest !== D692_QUALIFIED_SCORECARD_DIGEST) {
		throw new TypeError("D692 scorecard bytes drifted from the exact qualified scorecard");
	}
	return scorecard;
}

export function validateD692HistoricalTransferForensicScorecard(
	value: unknown,
	forensic: D692HistoricalTransferForensicV1,
): D692HistoricalTransferForensicScorecardV1 {
	const candidate = record(value, "d692.scorecard");
	exactKeys(
		candidate,
		[
			"attemptedArms",
			"causalAttribution",
			"claimBoundary",
			"counterfactualDigest",
			"efficacyClaim",
			"forensicDigests",
			"inspectionOnlyArms",
			"memoryBoundArms",
			"mutationArms",
			"schemaVersion",
			"scorecardDigest",
			"status",
		],
		"d692.scorecard",
	);
	const expected = createD692HistoricalTransferForensicScorecard(forensic);
	literal(candidate.schemaVersion, expected.schemaVersion, "d692.scorecard.schemaVersion");
	literal(candidate.claimBoundary, expected.claimBoundary, "d692.scorecard.claimBoundary");
	literal(
		candidate.causalAttribution,
		expected.causalAttribution,
		"d692.scorecard.causalAttribution",
	);
	literal(candidate.efficacyClaim, expected.efficacyClaim, "d692.scorecard.efficacyClaim");
	if (!Array.isArray(candidate.forensicDigests) || candidate.forensicDigests.length !== 1) {
		throw new TypeError("D692 scorecard requires exactly one forensic digest");
	}
	const forensicDigests = array(candidate.forensicDigests, "d692.scorecard.forensicDigests");
	literal(
		digest(forensicDigests[0], "d692.scorecard.forensicDigests[0]"),
		expected.forensicDigests[0],
		"d692.scorecard.forensicDigests[0]",
	);
	literal(
		digest(candidate.counterfactualDigest, "d692.scorecard.counterfactualDigest"),
		expected.counterfactualDigest,
		"d692.scorecard.counterfactualDigest",
	);
	literal(candidate.attemptedArms, expected.attemptedArms, "d692.scorecard.attemptedArms");
	literal(
		candidate.inspectionOnlyArms,
		expected.inspectionOnlyArms,
		"d692.scorecard.inspectionOnlyArms",
	);
	literal(candidate.mutationArms, expected.mutationArms, "d692.scorecard.mutationArms");
	literal(candidate.memoryBoundArms, expected.memoryBoundArms, "d692.scorecard.memoryBoundArms");
	literal(candidate.status, expected.status, "d692.scorecard.status");
	literal(
		digest(candidate.scorecardDigest, "d692.scorecard.scorecardDigest"),
		expected.scorecardDigest,
		"d692.scorecard.scorecardDigest",
	);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(expected)) {
		throw new TypeError("D692 scorecard is not the canonical projection of its forensic report");
	}
	if (expected.scorecardDigest !== D692_QUALIFIED_SCORECARD_DIGEST) {
		throw new TypeError("D692 scorecard bytes drifted from the exact qualified scorecard");
	}
	return expected;
}

export async function persistD692PrivateGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly observation: D691HistoricalTransferObservationV1;
	readonly actorCapabilitySourceBytes: Uint8Array;
}): Promise<PersistedD692PrivateGenerationV1> {
	const request = record(input, "d692.persistence");
	exactKeys(
		request,
		["actorCapabilitySourceBytes", "generationRef", "observation", "privateRoot"],
		"d692.persistence",
	);
	const generationRef = literal(
		request.generationRef,
		D692_PRIVATE_GENERATION_REF,
		"d692.persistence.generationRef",
	);
	if (typeof request.privateRoot !== "string") {
		throw new TypeError("D692 persistence root must be an explicit path");
	}
	const privateRoot = await assertSafePrivateRoot(request.privateRoot);
	if (privateRoot !== (await assertSafePrivateRoot(D691_PRIVATE_PERSISTENCE_ROOT))) {
		throw new TypeError("D692 persistence root is not the exact repository-private eval root");
	}
	const forensic = createD692HistoricalTransferForensic({
		observation: request.observation as D691HistoricalTransferObservationV1,
		actorCapabilitySourceBytes: request.actorCapabilitySourceBytes as Uint8Array,
	});
	const scorecard = createD692HistoricalTransferForensicScorecard(forensic);
	const generation = strictSnapshot({
		schemaVersion: D692_HISTORICAL_TRANSFER_FORENSIC_GENERATION_VERSION,
		generationRef,
		forensicDigest: forensic.forensicDigest,
		counterfactualDigest: forensic.counterfactual.counterfactualDigest,
		scorecardDigest: scorecard.scorecardDigest,
		claimBoundary: D692_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const staging = join(privateRoot, `.d692-staging-${randomUUID()}`);
	const finalRoot = join(privateRoot, generationRef);
	try {
		await lstat(finalRoot)
			.then(() => {
				throw new TypeError("D692 generation already exists");
			})
			.catch((error: unknown) => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			});
		await mkdir(staging, { mode: 0o700 });
		await writePrivateCanonical(join(staging, "historical-transfer-forensic.v1.json"), forensic);
		await writePrivateCanonical(
			join(staging, "scripted-counterfactual.v1.json"),
			forensic.counterfactual,
		);
		await writePrivateCanonical(
			join(staging, "historical-transfer-forensic-scorecard.v1.json"),
			scorecard,
		);
		await writePrivateCanonical(join(staging, "generation.v1.json"), generation);
		await syncDirectory(staging);
		await rename(staging, finalRoot);
		await syncDirectory(privateRoot);
	} catch (error) {
		await rm(staging, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
	return Object.freeze({
		generationRef,
		forensicDigest: forensic.forensicDigest,
		counterfactualDigest: forensic.counterfactual.counterfactualDigest,
		scorecardDigest: scorecard.scorecardDigest,
		generationDigest: empiricalStrictJsonDigest(generation),
	});
}

async function writePrivateCanonical(path: string, value: unknown): Promise<void> {
	const bytes = strictJsonCodec.encode(value);
	await writePrivateFile(path, bytes);
	const persisted = await readFile(path);
	if (!Buffer.from(bytes).equals(persisted)) {
		throw new TypeError("D692 canonical private write verification failed");
	}
}
