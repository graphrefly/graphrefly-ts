import type { D686Member, D686PathObservation, D686Scenario } from "./contracts.js";

interface PlainRequest {
	readonly memberId: string;
	readonly effectRunId: string;
	readonly requestId: string;
	readonly operationId: string;
}

interface PlainCompletion {
	readonly resultId: string;
	readonly effectRunId: string;
	readonly operationId: string;
	readonly executionInputRevision: number;
	readonly status: "completed" | "failed";
}

export function runD686PlainTypescriptArm(scenario: D686Scenario): D686PathObservation {
	// D686_COORDINATOR:plain-typescript:dependency-rich-fan-out-fan-in:START
	const pending = new Map(scenario.members.map((member) => [member.memberId, member] as const));
	const terminal = new Map<string, "completed" | "failed">();
	const requests: PlainRequest[] = [];
	const admittedMemberIds: string[] = [];
	const admissionTrace: {
		memberId: string;
		prerequisiteStatuses: Record<string, "completed" | "failed">;
	}[] = [];
	const requestByEffectRun = new Map<string, PlainRequest>();
	const admitReady = (): void => {
		for (const member of scenario.members) {
			if (!pending.has(member.memberId)) continue;
			// D686_COORDINATOR:plain-typescript:failed-prerequisite-independent-branch-join:START
			if (member.dependsOnMemberIds.some((dependency) => terminal.get(dependency) === "failed")) {
				continue;
			}
			// D686_COORDINATOR:plain-typescript:failed-prerequisite-independent-branch-join:END
			if (
				!member.dependsOnMemberIds.every((dependency) => terminal.get(dependency) === "completed")
			) {
				continue;
			}
			pending.delete(member.memberId);
			admittedMemberIds.push(member.memberId);
			admissionTrace.push({
				memberId: member.memberId,
				prerequisiteStatuses: Object.fromEntries(
					member.dependsOnMemberIds.map((dependency) => [dependency, terminal.get(dependency)!]),
				),
			});
			const request: PlainRequest = {
				memberId: member.memberId,
				effectRunId: `plain-effect-run:${scenario.scenarioId}:${member.memberId}`,
				requestId: `plain-request:${scenario.scenarioId}:${member.memberId}`,
				operationId: `plain-operation:${scenario.scenarioId}:${member.memberId}`,
			};
			requests.push(request);
			requestByEffectRun.set(request.effectRunId, request);
		}
	};
	// D686_COORDINATOR:plain-typescript:dependency-rich-fan-out-fan-in:END

	const acceptedResultByEffectRun = new Map<string, string>();
	const rejectionCodes: string[] = [];
	// D686_COORDINATOR:plain-typescript:provenance-and-fault-governance:START
	const admitCompletion = (completion: PlainCompletion): boolean => {
		const request = requestByEffectRun.get(completion.effectRunId);
		if (request === undefined) {
			rejectionCodes.push("unissued-completion");
			return false;
		}
		if (completion.executionInputRevision !== 1) {
			rejectionCodes.push("stale-completion");
			return false;
		}
		if (completion.operationId !== request.operationId) {
			rejectionCodes.push("wrong-operation-completion");
			return false;
		}
		const existingResultId = acceptedResultByEffectRun.get(completion.effectRunId);
		if (existingResultId !== undefined) {
			rejectionCodes.push(
				existingResultId === completion.resultId ? "duplicate-completion" : "late-completion",
			);
			return false;
		}
		acceptedResultByEffectRun.set(completion.effectRunId, completion.resultId);
		terminal.set(request.memberId, completion.status);
		return true;
	};
	// D686_COORDINATOR:plain-typescript:provenance-and-fault-governance:END

	admitReady();
	let requestCursor = 0;
	let ordinal = 0;
	while (requestCursor < requests.length) {
		if (requestCursor > scenario.members.length) {
			throw new Error("D686 plain TypeScript exceeded its preregistered request bound");
		}
		const request = requests[requestCursor++]!;
		const member: D686Member = scenario.members.find(
			(candidate) => candidate.memberId === request.memberId,
		)!;
		if (scenario.injectProvenanceFaults && ordinal === 0) {
			admitCompletion({
				resultId: "d686-stale",
				effectRunId: request.effectRunId,
				operationId: request.operationId,
				executionInputRevision: 0,
				status: member.outcome,
			});
			admitCompletion({
				resultId: "d686-wrong-operation",
				effectRunId: request.effectRunId,
				operationId: "wrong-operation",
				executionInputRevision: 1,
				status: member.outcome,
			});
		}
		const completion: PlainCompletion = {
			resultId: `d686-result-${scenario.scenarioId}-${ordinal++}`,
			effectRunId: request.effectRunId,
			operationId: request.operationId,
			executionInputRevision: 1,
			status: member.outcome,
		};
		admitCompletion(completion);
		if (scenario.injectProvenanceFaults) {
			admitCompletion(completion);
			admitCompletion({ ...completion, resultId: `${completion.resultId}-late` });
		}
		admitReady();
	}
	const blockedMemberIds = scenario.members
		.filter(
			(member) =>
				!terminal.has(member.memberId) &&
				member.dependsOnMemberIds.some((dependency) => terminal.get(dependency) === "failed"),
		)
		.map((member) => member.memberId);
	return {
		arm: "plain-typescript",
		scenarioId: scenario.scenarioId,
		category: scenario.category,
		admittedMemberIds,
		admissionTrace,
		issuedRequestIds: requests.map((request) => request.requestId),
		requestBindings: requests.map((request) => ({ ...request })),
		completedMemberIds: [...terminal]
			.filter(([, status]) => status === "completed")
			.map(([memberId]) => memberId),
		failedMemberIds: [...terminal]
			.filter(([, status]) => status === "failed")
			.map(([memberId]) => memberId),
		blockedMemberIds,
		rejectionCodes: rejectionCodes.sort(),
		terminalStatus:
			[...terminal.values()].includes("failed") || blockedMemberIds.length > 0
				? "failed"
				: "succeeded",
		provenanceAuthority: "plain-typescript-arm",
		topology: null,
	};
}
