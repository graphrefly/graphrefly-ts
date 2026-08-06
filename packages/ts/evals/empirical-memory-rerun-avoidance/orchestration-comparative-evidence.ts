import type { DataIssue } from "../../src/data/index.js";
import { graph } from "../../src/graph/graph.js";
import type { Node } from "../../src/node/node.js";
import {
	type AgentRequestIssued,
	type AgentRequestProposal,
	admitAgentRequestProposal,
	type EffectRun,
	type EffectRunResult,
	issueAgentRequest,
} from "../../src/orchestration/agent-runtime.js";
import {
	type WorkItemSeed,
	workItemEffectRunProjector,
} from "../../src/orchestration/work-item-runtime.js";
import {
	type WorkItemEffectPlanProposed,
	type WorkItemEffectPlanResult,
	type WorkItemProjection,
	workItemEffectPlanProjector,
} from "../../src/solutions/work-item/scheduling.js";
import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { runD683PlainTypescriptPath } from "./orchestration-comparative-plain-typescript.js";

export const ORCHESTRATION_COMPARISON_VERSION = "graphrefly-orchestration-comparison.d683.v1";
export const ORCHESTRATION_COMPARISON_CLAIM_BOUNDARY =
	"exact-offline-comparative-case-study-no-universal-superiority-claim";

export type D683ScenarioCategory =
	| "dependency-rich-fan-out-fan-in"
	| "provenance-and-fault"
	| "simple-linear-negative-control";

export interface D683Member {
	readonly memberId: string;
	readonly dependsOnMemberIds: readonly string[];
	readonly outcome: "completed" | "failed";
}

export interface D683Scenario {
	readonly scenarioId: string;
	readonly category: D683ScenarioCategory;
	readonly members: readonly D683Member[];
	readonly injectFaults: boolean;
}

export interface D683PathObservation {
	readonly path: "graphrefly" | "plain-typescript";
	readonly issuedMemberIds: readonly string[];
	readonly completedMemberIds: readonly string[];
	readonly failedMemberIds: readonly string[];
	readonly blockedMemberIds: readonly string[];
	readonly terminalStatus: "succeeded" | "failed";
	readonly rejectedFaultCodes: readonly string[];
	readonly faultAuthority: "outer-completion-admission";
	readonly topology: null | {
		readonly nodeCount: number;
		readonly edgeCount: number;
		readonly namedNodeCount: number;
	};
	readonly observedCoordination: {
		readonly measurementStatus: "not-collected";
		readonly handwrittenMutableCollectionCount: null;
		readonly transitionBranchCount: null;
	};
}

export interface D683ScenarioEvidence {
	readonly scenarioId: string;
	readonly category: D683ScenarioCategory;
	readonly verifierPassed: boolean;
	readonly behaviorDigest: string;
	readonly graphrefly: D683PathObservation;
	readonly plainTypescript: D683PathObservation;
	readonly coverage: {
		readonly dependencyEdgeCount: number;
		readonly failedDependencyCovered: boolean;
		readonly provenanceFaultCodes: readonly string[];
		readonly provenanceFaultAuthority: "outer-completion-admission";
	};
	readonly extensionChangeSurface: {
		readonly measurementStatus: "not-collected";
		readonly fileCount: null;
		readonly hunkCount: null;
		readonly testCount: null;
	};
}

export interface D683ComparativeEvidenceV1 {
	readonly version: typeof ORCHESTRATION_COMPARISON_VERSION;
	readonly claimBoundary: typeof ORCHESTRATION_COMPARISON_CLAIM_BOUNDARY;
	readonly networkCalls: 0;
	readonly qualificationStatus: "partial-offline";
	readonly missingEvidence: readonly [
		"handwritten-coordination-source-audit",
		"preregistered-dependency-extension-change-surface",
	];
	readonly scenarios: readonly D683ScenarioEvidence[];
	readonly favorableCaseCount: number;
	readonly negativeControlCount: number;
	readonly allBehaviorallyEquivalent: boolean;
	readonly evidenceDigest: string;
}

const SCENARIOS: readonly D683Scenario[] = Object.freeze([
	{
		scenarioId: "d683-fan-out-fan-in",
		category: "dependency-rich-fan-out-fan-in",
		injectFaults: false,
		members: [
			{ memberId: "load", dependsOnMemberIds: [], outcome: "completed" },
			{ memberId: "left", dependsOnMemberIds: ["load"], outcome: "completed" },
			{ memberId: "right", dependsOnMemberIds: ["load"], outcome: "completed" },
			{ memberId: "join", dependsOnMemberIds: ["left", "right"], outcome: "completed" },
		],
	},
	{
		scenarioId: "d683-provenance-fault",
		category: "provenance-and-fault",
		injectFaults: true,
		members: [
			{ memberId: "root", dependsOnMemberIds: [], outcome: "completed" },
			{ memberId: "failing", dependsOnMemberIds: ["root"], outcome: "failed" },
			{ memberId: "blocked", dependsOnMemberIds: ["failing"], outcome: "completed" },
		],
	},
	{
		scenarioId: "d683-simple-linear",
		category: "simple-linear-negative-control",
		injectFaults: false,
		members: [
			{ memberId: "first", dependsOnMemberIds: [], outcome: "completed" },
			{ memberId: "second", dependsOnMemberIds: ["first"], outcome: "completed" },
		],
	},
]);

function collectData<T>(node: Node<T>): T[] {
	const values: T[] = [];
	node.subscribe((message) => {
		if (message[0] === "DATA") values.push(message[1] as T);
	});
	return values;
}

function portableCoordinate(value: string, field: string): void {
	if (value.length === 0 || value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
		throw new TypeError(`${field} must be a bounded portable coordinate`);
	}
}

function validateScenario(scenario: D683Scenario): D683Scenario {
	portableCoordinate(scenario.scenarioId, "d683.scenarioId");
	if (scenario.members.length < 1 || scenario.members.length > 32) {
		throw new TypeError("d683 scenario must contain 1..32 members");
	}
	const seen = new Set<string>();
	for (const member of scenario.members) {
		portableCoordinate(member.memberId, "d683.memberId");
		if (seen.has(member.memberId)) throw new TypeError("d683 memberId must be unique");
		for (const dependency of member.dependsOnMemberIds) {
			if (!seen.has(dependency))
				throw new TypeError("d683 dependencies must reference prior members");
		}
		seen.add(member.memberId);
	}
	return strictSnapshot(scenario);
}

function issuedForRun(run: EffectRun, memberId: string): AgentRequestIssued {
	const proposal: AgentRequestProposal = {
		kind: "proposal",
		proposalId: `d683:proposal:${run.effectRunId}`,
		effectRunId: run.effectRunId,
		agentRunId: run.agentRunId,
		requestKind: "executor",
		required: true,
		input: run.goal.input,
		payload: run.goal.input?.value,
		reason: "D683 offline comparative execution",
		metadata: { scenarioMemberId: memberId },
	};
	const admission = admitAgentRequestProposal(proposal, {
		requestId: `d683:request:${run.effectRunId}`,
		operationId: `d683:operation:${run.effectRunId}`,
		admittedAtMs: 0,
		reason: "D683 offline comparative admission",
		sourceRefs: run.sourceRefs,
	});
	return issueAgentRequest(proposal, admission, { issuedAtMs: 0, sourceRefs: run.sourceRefs });
}

function resultFor(
	issued: AgentRequestIssued,
	member: D683Member,
	ordinal: number,
): EffectRunResult {
	const base = {
		kind: "effect-run-result" as const,
		resultId: `d683-result-${ordinal}`,
		effectRunId: issued.effectRunId,
		operationId: issued.operationId,
		sourceRefs: [{ kind: "agent-request" as const, id: issued.requestId }],
		completedAtMs: ordinal,
		metadata: { executionInputRevision: 1 },
	};
	return member.outcome === "completed"
		? {
				...base,
				status: "completed",
				output: { kind: "d683-offline-result", value: { memberId: member.memberId } },
			}
		: {
				...base,
				status: "failed",
				error: {
					kind: "issue",
					code: "d683-preregistered-failure",
					message: "D683 injected the preregistered member failure.",
					severity: "error",
				},
			};
}

function blockedMembers(scenario: D683Scenario, terminal: ReadonlyMap<string, string>): string[] {
	const blocked: string[] = [];
	for (const member of scenario.members) {
		if (terminal.has(member.memberId)) continue;
		if (
			member.dependsOnMemberIds.some(
				(dependency) => terminal.get(dependency) === "failed" || blocked.includes(dependency),
			)
		) {
			blocked.push(member.memberId);
		}
	}
	return blocked;
}

function runGraphReFlyPath(scenarioInput: D683Scenario): D683PathObservation {
	const scenario = validateScenario(scenarioInput);
	const g = graph({ name: `d683-${scenario.scenarioId}` });
	const workItems = g.node<WorkItemProjection<Record<string, unknown>>>([], null, {
		name: "d683/work-items",
	});
	const workItemSeeds = g.node<WorkItemSeed>([], null, { name: "d683/work-item-seeds" });
	const proposals = g.node<WorkItemEffectPlanProposed<Record<string, unknown>>>([], null, {
		name: "d683/plan-proposals",
	});
	const admittedResults = g.node<EffectRunResult>([], null, { name: "d683/admitted-results" });
	const plan = workItemEffectPlanProjector(g, {
		name: "d683/effect-plan",
		workItems,
		proposals,
		effectRunResults: admittedResults,
		policy: { allowedEffectKinds: ["d683-offline-effect"] },
		now: () => 0,
	});
	const effectRuns = workItemEffectRunProjector(g, {
		name: "d683/effect-runs",
		workItems: workItemSeeds,
		effectRequests: plan.effectRequests,
	});
	const runs = collectData<EffectRun>(effectRuns.effectRuns);
	const planResults = collectData<WorkItemEffectPlanResult>(plan.results);
	const planIssues = collectData<DataIssue>(plan.issues);
	const issued: AgentRequestIssued[] = [];
	const issuedByEffectRun = new Map<string, AgentRequestIssued>();
	const memberByEffectRun = new Map<string, string>();
	const acceptedResultIds = new Set<string>();
	const rejectedFaultCodes: string[] = [];
	let runCursor = 0;
	const drainRuns = (): void => {
		while (runCursor < runs.length) {
			const run = runs[runCursor++]!;
			const memberId =
				typeof run.metadata?.planMemberId === "string" ? run.metadata.planMemberId : "";
			portableCoordinate(memberId, "d683.run.planMemberId");
			const request = issuedForRun(run, memberId);
			issued.push(request);
			issuedByEffectRun.set(run.effectRunId, request);
			memberByEffectRun.set(run.effectRunId, memberId);
		}
	};
	const admitResult = (result: EffectRunResult): boolean => {
		const request = issuedByEffectRun.get(result.effectRunId);
		if (request === undefined) {
			rejectedFaultCodes.push("unissued-effect-run");
			return false;
		}
		if (result.metadata?.executionInputRevision !== 1) {
			rejectedFaultCodes.push("stale-result");
			return false;
		}
		if (result.operationId !== request.operationId) {
			rejectedFaultCodes.push("wrong-operation");
			return false;
		}
		if (acceptedResultIds.has(result.resultId)) {
			rejectedFaultCodes.push("duplicate-result");
			return false;
		}
		acceptedResultIds.add(result.resultId);
		admittedResults.down([["DATA", result]]);
		return true;
	};
	const projection: WorkItemProjection<Record<string, unknown>> = {
		workItemId: `work-item-${scenario.scenarioId}`,
		summary: "D683 offline comparative scenario",
		authoringRevision: 1,
		executionInputRevision: 1,
		lastEventId: `event-${scenario.scenarioId}`,
	};
	workItemSeeds.down([
		["DATA", { kind: "work-item", workItemId: projection.workItemId, summary: projection.summary }],
	]);
	workItems.down([["DATA", projection]]);
	proposals.down([
		[
			"DATA",
			{
				kind: "work-item-effect-plan-proposed",
				planId: `plan-${scenario.scenarioId}`,
				workItemId: projection.workItemId,
				executionInputRevision: 1,
				joinPolicy: "all-required",
				members: scenario.members.map((member) => ({
					memberId: member.memberId,
					effectKind: "d683-offline-effect",
					required: true,
					dependsOnMemberIds: member.dependsOnMemberIds,
					goal: {
						kind: "d683-offline-effect",
						input: {
							inputId: `${scenario.scenarioId}:${member.memberId}`,
							inputKind: "d683-offline-effect",
							dataMode: "inline",
							value: { memberId: member.memberId },
						},
					},
				})),
			} satisfies WorkItemEffectPlanProposed<Record<string, unknown>>,
		],
	]);
	drainRuns();
	if (scenario.injectFaults) {
		const first = issued[0]!;
		admitResult({
			...resultFor(first, scenario.members[0]!, 0),
			resultId: "d683-stale-result",
			metadata: { executionInputRevision: 0 },
		});
		admitResult({
			...resultFor(first, scenario.members[0]!, 0),
			operationId: "d683-wrong-operation",
		});
	}
	let issuedCursor = 0;
	let ordinal = 1;
	while (issuedCursor < issued.length) {
		const request = issued[issuedCursor++]!;
		const memberId = memberByEffectRun.get(request.effectRunId)!;
		const member = scenario.members.find((candidate) => candidate.memberId === memberId)!;
		const result = resultFor(request, member, ordinal++);
		admitResult(result);
		if (scenario.injectFaults && issuedCursor === 1) admitResult(result);
		drainRuns();
	}
	const topology = g.topology();
	const planResult = planResults.at(-1);
	if (planResult === undefined)
		throw new Error(`D683 GraphReFly path did not settle ${scenario.scenarioId}`);
	const terminal = new Map(
		planResult.memberResults.map((member) => [member.planMemberId, member.status] as const),
	);
	return strictSnapshot({
		path: "graphrefly" as const,
		issuedMemberIds: issued.map((request) => memberByEffectRun.get(request.effectRunId)!),
		completedMemberIds: [...terminal]
			.filter(([, status]) => status === "completed")
			.map(([id]) => id),
		failedMemberIds: [...terminal].filter(([, status]) => status === "failed").map(([id]) => id),
		blockedMemberIds: blockedMembers(scenario, terminal),
		terminalStatus: planResult.status === "succeeded" ? "succeeded" : "failed",
		rejectedFaultCodes: [...rejectedFaultCodes, ...planIssues.map((issue) => issue.code)].sort(),
		faultAuthority: "outer-completion-admission" as const,
		topology: {
			nodeCount: topology.nodes.length,
			edgeCount: topology.edges.length,
			namedNodeCount: topology.nodes.filter((node) => node.name !== undefined).length,
		},
		observedCoordination: {
			measurementStatus: "not-collected" as const,
			handwrittenMutableCollectionCount: null,
			transitionBranchCount: null,
		},
	});
}

function behaviorProjection(observation: D683PathObservation): unknown {
	return {
		issuedMemberIds: observation.issuedMemberIds,
		completedMemberIds: observation.completedMemberIds,
		failedMemberIds: observation.failedMemberIds,
		blockedMemberIds: observation.blockedMemberIds,
		terminalStatus: observation.terminalStatus,
		rejectedFaultCodes: observation.rejectedFaultCodes,
		faultAuthority: observation.faultAuthority,
	};
}

function expectedBehavior(scenario: D683Scenario): unknown {
	const terminal = new Map<string, "completed" | "failed" | "blocked">();
	const issuedMemberIds: string[] = [];
	for (const member of scenario.members) {
		const blocked = member.dependsOnMemberIds.some(
			(dependency) =>
				terminal.get(dependency) === "failed" || terminal.get(dependency) === "blocked",
		);
		if (blocked) {
			terminal.set(member.memberId, "blocked");
			continue;
		}
		issuedMemberIds.push(member.memberId);
		terminal.set(member.memberId, member.outcome);
	}
	const completedMemberIds = scenario.members
		.filter((member) => terminal.get(member.memberId) === "completed")
		.map((member) => member.memberId);
	const failedMemberIds = scenario.members
		.filter((member) => terminal.get(member.memberId) === "failed")
		.map((member) => member.memberId);
	const blockedMemberIds = scenario.members
		.filter((member) => terminal.get(member.memberId) === "blocked")
		.map((member) => member.memberId);
	return {
		issuedMemberIds,
		completedMemberIds,
		failedMemberIds,
		blockedMemberIds,
		terminalStatus:
			failedMemberIds.length > 0 || blockedMemberIds.length > 0 ? "failed" : "succeeded",
		rejectedFaultCodes: scenario.injectFaults
			? ["duplicate-result", "stale-result", "wrong-operation"]
			: [],
		faultAuthority: "outer-completion-admission",
	};
}

export function runD683OfflineComparativeEvidence(): D683ComparativeEvidenceV1 {
	const scenarios = SCENARIOS.map((scenario) => {
		const graphrefly = runGraphReFlyPath(scenario);
		const plainTypescript = strictSnapshot(runD683PlainTypescriptPath(scenario));
		const graphBehavior = behaviorProjection(graphrefly);
		const plainBehavior = behaviorProjection(plainTypescript);
		const expectedDigest = empiricalStrictJsonDigest(expectedBehavior(scenario));
		const verifierPassed =
			empiricalStrictJsonDigest(graphBehavior) === expectedDigest &&
			empiricalStrictJsonDigest(plainBehavior) === expectedDigest;
		return strictSnapshot({
			scenarioId: scenario.scenarioId,
			category: scenario.category,
			verifierPassed,
			behaviorDigest: empiricalStrictJsonDigest(graphBehavior),
			graphrefly,
			plainTypescript,
			coverage: {
				dependencyEdgeCount: scenario.members.reduce(
					(sum, member) => sum + member.dependsOnMemberIds.length,
					0,
				),
				failedDependencyCovered: scenario.members.some((member) =>
					member.dependsOnMemberIds.some(
						(dependency) =>
							scenario.members.find((candidate) => candidate.memberId === dependency)?.outcome ===
							"failed",
					),
				),
				provenanceFaultCodes: graphrefly.rejectedFaultCodes,
				provenanceFaultAuthority: graphrefly.faultAuthority,
			},
			extensionChangeSurface: {
				measurementStatus: "not-collected" as const,
				fileCount: null,
				hunkCount: null,
				testCount: null,
			},
		});
	});
	const withoutDigest: Omit<D683ComparativeEvidenceV1, "evidenceDigest"> = {
		version: ORCHESTRATION_COMPARISON_VERSION,
		claimBoundary: ORCHESTRATION_COMPARISON_CLAIM_BOUNDARY,
		networkCalls: 0 as const,
		qualificationStatus: "partial-offline" as const,
		missingEvidence: [
			"handwritten-coordination-source-audit",
			"preregistered-dependency-extension-change-surface",
		] as const,
		scenarios,
		favorableCaseCount: scenarios.filter(
			(scenario) => scenario.category !== "simple-linear-negative-control",
		).length,
		negativeControlCount: scenarios.filter(
			(scenario) => scenario.category === "simple-linear-negative-control",
		).length,
		allBehaviorallyEquivalent: scenarios.every((scenario) => scenario.verifierPassed),
	};
	return strictSnapshot({
		...withoutDigest,
		evidenceDigest: empiricalStrictJsonDigest(withoutDigest),
	});
}
