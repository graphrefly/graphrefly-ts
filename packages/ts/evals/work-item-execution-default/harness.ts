import { graph } from "../../src/graph/graph.js";
import type { Node } from "../../src/node/node.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	AgentRequestViews,
	EffectRun,
	EffectRunResult,
} from "../../src/orchestration/agent-runtime.js";
import type {
	WorkItemEffectPlanProposed,
	WorkItemProjection,
} from "../../src/solutions/work-item/scheduling.js";
import type {
	D687Arm,
	D687ArmComposer,
	D687Input,
	D687Member,
	D687Observation,
	D687Scenario,
} from "./contracts.js";

function collectData<T>(node: Node<T>): T[] {
	const values: T[] = [];
	node.subscribe((message) => {
		if (message[0] === "DATA") values.push(message[1] as T);
	});
	return values;
}

function workItemIdFor(run: EffectRun): string {
	return run.sourceRefs?.find((ref) => ref.kind === "work-item")?.id ?? "";
}

function resultFor(
	request: AgentRequestIssued,
	member: D687Member,
	executionInputRevision: number,
	ordinal: number,
): EffectRunResult {
	const common = {
		kind: "effect-run-result" as const,
		resultId: `d687-result:${request.effectRunId}:${ordinal}`,
		effectRunId: request.effectRunId,
		operationId: request.operationId,
		completedAtMs: 0,
		metadata: {
			executionInputRevision,
			planMemberId: member.memberId,
		},
	};
	return member.outcome === "completed"
		? {
				...common,
				status: "completed",
				output: { kind: "d687-output", value: { memberId: member.memberId } },
			}
		: {
				...common,
				status: "failed",
				error: {
					kind: "issue",
					code: "d687-preregistered-failure",
					message: "D687 injected the preregistered member failure.",
					severity: "error",
				},
			};
}

function ledgerProjection(view: AgentRequestViews | undefined): unknown {
	if (view === undefined) return null;
	return {
		requestsById: [...view.requestsById].sort(([left], [right]) => left.localeCompare(right)),
		requestsByEffectRun: [...view.requestsByEffectRun].sort(([left], [right]) =>
			left.localeCompare(right),
		),
		statusByRequest: [...view.statusByRequest].sort(([left], [right]) => left.localeCompare(right)),
		pending: view.pending,
		awaitingProvider: view.awaitingProvider,
		issues: view.issues,
	};
}

function stableSort<T>(values: readonly T[], key: (value: T) => string): T[] {
	return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

function canonicalObservation(value: D687Observation): D687Observation {
	return JSON.parse(JSON.stringify(value)) as D687Observation;
}

function normalizeTopologyId(id: string): string {
	return id
		.replace("d687/current-primitives-manual", "d687/arm")
		.replace("d687/default-recipe", "d687/arm")
		.replace("d687/manual", "d687/arm")
		.replace("d687/recipe", "d687/arm");
}

export function runD687Arm(
	arm: D687Arm,
	scenario: D687Scenario,
	compose: D687ArmComposer,
): D687Observation {
	const g = graph({ name: `d687/${arm}/${scenario.scenarioId}` });
	const workItems = g.node<WorkItemProjection<D687Input>>([], null, {
		name: `d687/${arm}/workItems`,
	});
	const proposals = g.node<WorkItemEffectPlanProposed<D687Input>>([], null, {
		name: `d687/${arm}/proposals`,
	});
	const admittedResults = g.node<EffectRunResult>([], null, {
		name: `d687/${arm}/admittedResults`,
	});
	const bundle = compose(g, { workItems, proposals, admittedResults });
	const seeds = collectData(bundle.workItemSeeds);
	const effectRequests = collectData(bundle.plan.effectRequests);
	const runs = collectData<EffectRun<D687Input>>(bundle.effectRuns.effectRuns);
	const requestFacts = collectData<AgentRequestFact<D687Input>>(bundle.requestFacts);
	const requests = collectData<AgentRequestIssued<D687Input>>(bundle.requests);
	const ledgerViews = collectData<AgentRequestViews>(bundle.requestLedger.views);
	const planResults = collectData(bundle.plan.results);
	const planIssues = collectData(bundle.plan.issues);

	for (const item of scenario.workItems) {
		workItems.down([
			[
				"DATA",
				{
					workItemId: item.workItemId,
					summary: `D687 ${scenario.scenarioId}`,
					authoringRevision: item.authoringRevision,
					executionInputRevision: item.executionInputRevision,
					lastEventId: `event:${item.workItemId}:${item.authoringRevision}`,
					revisionSourceRefs: [
						{ kind: "work-item-revision", id: `${item.workItemId}:${item.authoringRevision}` },
					],
				} satisfies WorkItemProjection<D687Input>,
			],
		]);
	}
	for (const item of scenario.workItems) {
		const proposal = {
			kind: "work-item-effect-plan-proposed",
			planId: `plan:${item.workItemId}`,
			workItemId: item.workItemId,
			executionInputRevision: item.executionInputRevision,
			joinPolicy: item.joinPolicy,
			policyRefs: [{ kind: "plan-policy", id: `plan-policy:${item.workItemId}` }],
			sourceRefs: [{ kind: "scenario", id: scenario.scenarioId }],
			members: item.members.map((member) => ({
				memberId: member.memberId,
				effectKind: member.effectKind,
				required: member.required,
				dependsOnMemberIds: member.dependsOnMemberIds,
				goal: {
					kind: member.effectKind,
					input: {
						inputId: `${item.workItemId}:${member.memberId}`,
						inputKind: member.effectKind,
						dataMode: "inline" as const,
						value: member.input,
					},
				},
				limits: member.limits,
				policyRefs: member.policyRefs,
				sourceRefs: member.sourceRefs,
			})),
		} satisfies WorkItemEffectPlanProposed<D687Input>;
		proposals.down([["DATA", proposal]]);
		if (item.duplicateProposal) proposals.down([["DATA", proposal]]);
	}

	let requestCursor = 0;
	let ordinal = 0;
	const totalMembers = scenario.workItems.reduce((count, item) => count + item.members.length, 0);
	while (requestCursor < requests.length) {
		if (requestCursor >= totalMembers) {
			throw new Error(`D687 ${arm}/${scenario.scenarioId} exceeded its member bound`);
		}
		const request = requests[requestCursor++]!;
		const run = runs.find((candidate) => candidate.effectRunId === request.effectRunId);
		if (run === undefined) throw new Error("D687 issued a request without an EffectRun");
		const workItemId = workItemIdFor(run);
		const item = scenario.workItems.find((candidate) => candidate.workItemId === workItemId);
		const memberId = String(run.metadata?.planMemberId ?? "");
		const member = item?.members.find((candidate) => candidate.memberId === memberId);
		if (item === undefined || member === undefined) {
			throw new Error("D687 could not bind an issued request to its frozen member");
		}
		admittedResults.down([
			["DATA", resultFor(request, member, item.executionInputRevision, ordinal++)],
		]);
	}
	const topology = g.topology();
	const stageSpecs = [
		{ id: "d687/arm/workItems" },
		{ id: "d687/arm/proposals" },
		{ id: "d687/arm/admittedResults" },
		{ id: "d687/arm/workItemSeeds" },
		{ id: "d687/arm/plan/effectRequests" },
		{ id: "d687/arm/plan/results" },
		{ id: "d687/arm/effectRuns/effectRuns" },
		{ id: "d687/arm/requestFacts" },
		{ id: "d687/arm/requests" },
		{ id: "d687/arm/requestLedger/views" },
	] as const;
	const actualByStageId = new Map(
		stageSpecs.map((stage) => {
			const actual = topology.nodes.find((node) => normalizeTopologyId(node.id) === stage.id);
			if (actual === undefined)
				throw new Error(`D687 is missing graph-visible stage '${stage.id}'`);
			return [stage.id, actual] as const;
		}),
	);
	const topologyById = new Map(topology.nodes.map((node) => [node.id, node]));
	const reaches = (from: string, to: string): boolean => {
		const seen = new Set<string>();
		const pending = [...(topologyById.get(to)?.deps ?? [])];
		while (pending.length > 0) {
			const current = pending.pop()!;
			if (current === from) return true;
			if (seen.has(current)) continue;
			seen.add(current);
			pending.push(...(topologyById.get(current)?.deps ?? []));
		}
		return false;
	};
	const stageEdges = stageSpecs.flatMap((to) =>
		stageSpecs.flatMap((from) => {
			if (from.id === to.id) return [];
			const actualFrom = actualByStageId.get(from.id)!;
			const actualTo = actualByStageId.get(to.id)!;
			if (!reaches(actualFrom.id, actualTo.id)) return [];
			const hasSelectedIntermediate = stageSpecs.some((middle) => {
				if (middle.id === from.id || middle.id === to.id) return false;
				const actualMiddle = actualByStageId.get(middle.id)!;
				return reaches(actualFrom.id, actualMiddle.id) && reaches(actualMiddle.id, actualTo.id);
			});
			return hasSelectedIntermediate ? [] : [{ from: from.id, to: to.id }];
		}),
	);
	const stageNodes = stageSpecs.map((stage) => ({
		id: stage.id,
		factory: actualByStageId.get(stage.id)!.factory,
		deps: stageEdges
			.filter((edge) => edge.to === stage.id)
			.map((edge) => edge.from)
			.sort(),
	}));
	return canonicalObservation({
		arm,
		scenarioId: scenario.scenarioId,
		workItemSeeds: stableSort(seeds, (seed) => seed.workItemId),
		effectRequests: stableSort(effectRequests, (request) => request.requestId),
		effectRuns: stableSort(runs, (run) => run.effectRunId),
		requestFacts: stableSort(requestFacts, (fact) => {
			const id = "requestId" in fact ? fact.requestId : fact.proposalId;
			return `${id}:${fact.kind}`;
		}),
		issuedRequests: stableSort(requests, (request) => request.requestId),
		ledgerViews: [ledgerProjection(ledgerViews.at(-1))],
		planResults: stableSort(planResults, (result) => result.resultId),
		planIssueCodes: planIssues.map((issue) => issue.code).sort(),
		topology: {
			nodes: stageNodes,
			edges: stageEdges.sort((left, right) =>
				`${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`),
			),
		},
	});
}
