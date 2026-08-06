export interface D683PlainScenarioMember {
	readonly memberId: string;
	readonly dependsOnMemberIds: readonly string[];
	readonly outcome: "completed" | "failed";
}

export interface D683PlainScenario {
	readonly members: readonly D683PlainScenarioMember[];
	readonly injectFaults: boolean;
}

export interface D683PlainPathObservation {
	readonly path: "plain-typescript";
	readonly issuedMemberIds: readonly string[];
	readonly completedMemberIds: readonly string[];
	readonly failedMemberIds: readonly string[];
	readonly blockedMemberIds: readonly string[];
	readonly terminalStatus: "succeeded" | "failed";
	readonly rejectedFaultCodes: readonly string[];
	readonly faultAuthority: "outer-completion-admission";
	readonly topology: null;
	readonly observedCoordination: {
		readonly measurementStatus: "not-collected";
		readonly handwrittenMutableCollectionCount: null;
		readonly transitionBranchCount: null;
	};
}

/** Independent reference state machine: deliberately imports no GraphReFly source or runtime. */
export function runD683PlainTypescriptPath(scenario: D683PlainScenario): D683PlainPathObservation {
	const states = new Map<string, "pending" | "issued" | "completed" | "failed" | "blocked">(
		scenario.members.map((member) => [member.memberId, "pending"]),
	);
	const operations = new Map<string, string>();
	const acceptedResultIds = new Set<string>();
	const issuedMemberIds: string[] = [];
	const rejectedFaultCodes: string[] = [];
	const schedule = (): void => {
		for (const member of scenario.members) {
			if (states.get(member.memberId) !== "pending") continue;
			if (
				member.dependsOnMemberIds.some(
					(dependency) =>
						states.get(dependency) === "failed" || states.get(dependency) === "blocked",
				)
			) {
				states.set(member.memberId, "blocked");
				continue;
			}
			if (member.dependsOnMemberIds.every((dependency) => states.get(dependency) === "completed")) {
				states.set(member.memberId, "issued");
				operations.set(member.memberId, `plain-operation:${member.memberId}`);
				issuedMemberIds.push(member.memberId);
			}
		}
	};
	const complete = (
		memberId: string,
		operationId: string,
		resultId: string,
		executionInputRevision = 1,
	): boolean => {
		// D683_QA_CORRECTION:duplicate-admission reject an accepted result before terminal-state checks.
		if (acceptedResultIds.has(resultId)) {
			rejectedFaultCodes.push("duplicate-result");
			return false;
		}
		if (states.get(memberId) !== "issued") {
			rejectedFaultCodes.push("unissued-effect-run");
			return false;
		}
		if (executionInputRevision !== 1) {
			rejectedFaultCodes.push("stale-result");
			return false;
		}
		if (operations.get(memberId) !== operationId) {
			rejectedFaultCodes.push("wrong-operation");
			return false;
		}
		// D683_QA_CORRECTION:duplicate-admission the former late duplicate check was removed here.
		acceptedResultIds.add(resultId);
		states.set(memberId, scenario.members.find((member) => member.memberId === memberId)!.outcome);
		return true;
	};
	schedule();
	if (scenario.injectFaults) {
		complete(issuedMemberIds[0]!, operations.get(issuedMemberIds[0]!)!, "plain-stale-result", 0);
		complete(issuedMemberIds[0]!, "plain-wrong-operation", "plain-wrong-operation-result");
	}
	let cursor = 0;
	while (cursor < issuedMemberIds.length) {
		const memberId = issuedMemberIds[cursor++]!;
		const resultId = `plain-result:${memberId}`;
		complete(memberId, operations.get(memberId)!, resultId);
		if (scenario.injectFaults && cursor === 1 && acceptedResultIds.has(resultId)) {
			// D683_QA_CORRECTION:duplicate-admission resubmit through the real completion path.
			complete(memberId, operations.get(memberId)!, resultId);
		}
		schedule();
	}
	const completedMemberIds = scenario.members
		.filter((member) => states.get(member.memberId) === "completed")
		.map((member) => member.memberId);
	const failedMemberIds = scenario.members
		.filter((member) => states.get(member.memberId) === "failed")
		.map((member) => member.memberId);
	const blockedMemberIds = scenario.members
		.filter((member) => states.get(member.memberId) === "blocked")
		.map((member) => member.memberId);
	return {
		path: "plain-typescript",
		issuedMemberIds,
		completedMemberIds,
		failedMemberIds,
		blockedMemberIds,
		terminalStatus:
			failedMemberIds.length > 0 || blockedMemberIds.length > 0 ? "failed" : "succeeded",
		rejectedFaultCodes: rejectedFaultCodes.sort(),
		faultAuthority: "outer-completion-admission",
		topology: null,
		observedCoordination: {
			measurementStatus: "not-collected",
			handwrittenMutableCollectionCount: null,
			transitionBranchCount: null,
		},
	};
}
