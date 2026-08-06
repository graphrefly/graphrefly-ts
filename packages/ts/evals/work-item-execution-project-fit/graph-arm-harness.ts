import { type Graph, graph } from "../../src/graph/graph.js";
import type { Node } from "../../src/node/node.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	EffectRun,
	EffectRunResult,
} from "../../src/orchestration/agent-runtime.js";
import type {
	WorkItemEffectRunBundle,
	WorkItemSeed,
} from "../../src/orchestration/work-item-runtime.js";
import type {
	WorkItemEffectPlanProjectorBundle,
	WorkItemEffectPlanProposed,
	WorkItemProjection,
} from "../../src/solutions/work-item/scheduling.js";
import type { D686Arm, D686PathObservation, D686Scenario } from "./contracts.js";

type D686Input = Record<string, unknown>;

export interface D686GraphArmSources {
	readonly workItems: Node<WorkItemProjection<D686Input>>;
	readonly workItemSeeds: Node<WorkItemSeed>;
	readonly proposals: Node<WorkItemEffectPlanProposed<D686Input>>;
	readonly admittedResults: Node<EffectRunResult>;
}

export interface D686GraphArmBundle {
	readonly plan: WorkItemEffectPlanProjectorBundle<D686Input>;
	readonly effectRuns: WorkItemEffectRunBundle;
	readonly requestFacts: Node<AgentRequestFact<D686Input>>;
	readonly requests: Node<AgentRequestIssued<D686Input>>;
}

export type D686GraphArmComposer = (
	graph: Graph,
	sources: D686GraphArmSources,
) => D686GraphArmBundle;

function collectData<T>(node: Node<T>): T[] {
	const values: T[] = [];
	node.subscribe((message) => {
		if (message[0] === "DATA") values.push(message[1] as T);
	});
	return values;
}

function blockedMemberIds(
	scenario: D686Scenario,
	terminal: ReadonlyMap<string, EffectRunResult["status"]>,
): string[] {
	return scenario.members
		.filter(
			(member) =>
				!terminal.has(member.memberId) &&
				member.dependsOnMemberIds.some((dependency) => terminal.get(dependency) === "failed"),
		)
		.map((member) => member.memberId);
}

function resultFor(
	request: AgentRequestIssued,
	memberId: string,
	status: "completed" | "failed",
	resultId: string,
): EffectRunResult {
	const common = {
		kind: "effect-run-result" as const,
		resultId,
		effectRunId: request.effectRunId,
		operationId: request.operationId,
		completedAtMs: 0,
		metadata: { executionInputRevision: 1, memberId },
	};
	return status === "completed"
		? {
				...common,
				status,
				output: { kind: "d686-output", value: { memberId } },
			}
		: {
				...common,
				status,
				error: {
					kind: "issue",
					code: "d686-preregistered-failure",
					message: "D686 injected the preregistered member failure.",
					severity: "error",
				},
			};
}

export function runD686GraphArm(
	arm: Extract<D686Arm, "default-recipe" | "manual-graphrefly">,
	scenario: D686Scenario,
	compose: D686GraphArmComposer,
): D686PathObservation {
	const g = graph({ name: `${arm}/${scenario.scenarioId}` });
	const sources: D686GraphArmSources = {
		workItems: g.node([], null, { name: `${arm}/workItems` }),
		workItemSeeds: g.node([], null, { name: `${arm}/workItemSeeds` }),
		proposals: g.node([], null, { name: `${arm}/proposals` }),
		admittedResults: g.node([], null, { name: `${arm}/admittedResults` }),
	};
	const bundle = compose(g, sources);
	const runs = collectData<EffectRun>(bundle.effectRuns.effectRuns);
	const requests = collectData<AgentRequestIssued>(bundle.requests);
	const planResults = collectData(bundle.plan.results);
	const planIssues = collectData(bundle.plan.issues);
	const workItemId = `work-item-${scenario.scenarioId}`;
	const projection: WorkItemProjection<D686Input> = {
		workItemId,
		summary: "D686 project-fit scenario",
		authoringRevision: 1,
		executionInputRevision: 1,
		lastEventId: `event-${scenario.scenarioId}`,
	};
	sources.workItemSeeds.down([
		["DATA", { kind: "work-item", workItemId, summary: projection.summary }],
	]);
	sources.workItems.down([["DATA", projection]]);
	sources.proposals.down([
		[
			"DATA",
			{
				kind: "work-item-effect-plan-proposed",
				planId: `plan-${scenario.scenarioId}`,
				workItemId,
				executionInputRevision: 1,
				joinPolicy: "all-required",
				members: scenario.members.map((member) => ({
					memberId: member.memberId,
					effectKind: "d686-offline-effect",
					required: member.required,
					dependsOnMemberIds: member.dependsOnMemberIds,
					goal: {
						kind: "d686-offline-effect",
						input: {
							inputId: `${scenario.scenarioId}:${member.memberId}`,
							inputKind: "d686-offline-effect",
							dataMode: "inline",
							value: { memberId: member.memberId },
						},
					},
				})),
			} satisfies WorkItemEffectPlanProposed<D686Input>,
		],
	]);

	const terminal = new Map<string, EffectRunResult["status"]>();
	const admissionTrace: {
		memberId: string;
		prerequisiteStatuses: Record<string, "completed" | "failed">;
	}[] = [];
	const terminalEffectRuns = new Map<string, string>();
	const rejectionCodes: string[] = [];
	const requestByEffectRun = new Map<string, AgentRequestIssued>();
	const memberByEffectRun = new Map<string, string>();
	let indexedRuns = 0;
	let requestCursor = 0;
	let ordinal = 0;
	const indexNewFacts = (): void => {
		while (indexedRuns < runs.length) {
			const run = runs[indexedRuns++]!;
			const memberId = String(run.metadata?.planMemberId ?? "");
			memberByEffectRun.set(run.effectRunId, memberId);
			const member = scenario.members.find((candidate) => candidate.memberId === memberId)!;
			admissionTrace.push({
				memberId,
				prerequisiteStatuses: Object.fromEntries(
					member.dependsOnMemberIds.flatMap((dependency) => {
						const status = terminal.get(dependency);
						return status === "completed" || status === "failed" ? [[dependency, status]] : [];
					}),
				),
			});
		}
		for (const request of requests) requestByEffectRun.set(request.effectRunId, request);
	};
	// D686_COORDINATOR:default-recipe:provenance-and-fault-governance:START
	// D686_COORDINATOR:manual-graphrefly:provenance-and-fault-governance:START
	const admit = (candidate: EffectRunResult): boolean => {
		const request = requestByEffectRun.get(candidate.effectRunId);
		if (request === undefined) {
			rejectionCodes.push("unissued-completion");
			return false;
		}
		if (candidate.metadata?.executionInputRevision !== 1) {
			rejectionCodes.push("stale-completion");
			return false;
		}
		if (candidate.operationId !== request.operationId) {
			rejectionCodes.push("wrong-operation-completion");
			return false;
		}
		const existingResultId = terminalEffectRuns.get(candidate.effectRunId);
		if (existingResultId !== undefined) {
			rejectionCodes.push(
				existingResultId === candidate.resultId ? "duplicate-completion" : "late-completion",
			);
			return false;
		}
		terminalEffectRuns.set(candidate.effectRunId, candidate.resultId);
		const memberId = memberByEffectRun.get(candidate.effectRunId)!;
		terminal.set(memberId, candidate.status);
		sources.admittedResults.down([["DATA", candidate]]);
		return true;
	};
	// D686_COORDINATOR:manual-graphrefly:provenance-and-fault-governance:END
	// D686_COORDINATOR:default-recipe:provenance-and-fault-governance:END

	indexNewFacts();
	while (requestCursor < requests.length) {
		if (requestCursor > scenario.members.length) {
			throw new Error(`D686 ${arm} exceeded its preregistered request bound`);
		}
		const request = requests[requestCursor++]!;
		const memberId = memberByEffectRun.get(request.effectRunId)!;
		const member = scenario.members.find((candidate) => candidate.memberId === memberId)!;
		if (scenario.injectProvenanceFaults && ordinal === 0) {
			const stale = resultFor(request, memberId, member.outcome, "d686-stale");
			admit({ ...stale, metadata: { executionInputRevision: 0, memberId } });
			admit({ ...stale, resultId: "d686-wrong-operation", operationId: "wrong-operation" });
		}
		const result = resultFor(
			request,
			memberId,
			member.outcome,
			`d686-result-${scenario.scenarioId}-${ordinal++}`,
		);
		admit(result);
		if (scenario.injectProvenanceFaults) {
			admit(result);
			admit({ ...result, resultId: `${result.resultId}-late` });
		}
		indexNewFacts();
	}
	const finalPlanResult = planResults.at(-1);
	if (finalPlanResult === undefined) {
		throw new Error(`D686 ${arm} did not settle ${scenario.scenarioId}`);
	}
	const topology = g.topology();
	return {
		arm,
		scenarioId: scenario.scenarioId,
		category: scenario.category,
		admittedMemberIds: runs.map((run) => memberByEffectRun.get(run.effectRunId)!),
		admissionTrace,
		issuedRequestIds: requests.map((request) => request.requestId),
		requestBindings: requests.map((request) => ({
			memberId: memberByEffectRun.get(request.effectRunId)!,
			effectRunId: request.effectRunId,
			requestId: request.requestId,
			operationId: request.operationId,
		})),
		completedMemberIds: [...terminal]
			.filter(([, status]) => status === "completed")
			.map(([memberId]) => memberId),
		failedMemberIds: [...terminal]
			.filter(([, status]) => status === "failed")
			.map(([memberId]) => memberId),
		blockedMemberIds: blockedMemberIds(scenario, terminal),
		rejectionCodes: [...rejectionCodes, ...planIssues.map((issue) => issue.code)].sort(),
		terminalStatus: finalPlanResult.status === "succeeded" ? "succeeded" : "failed",
		provenanceAuthority: "caller-owned-shared-graph-harness",
		topology: {
			nodeCount: topology.nodes.length,
			edgeCount: topology.edges.length,
			namedNodeCount: topology.nodes.filter((node) => node.name !== undefined).length,
		},
	};
}
