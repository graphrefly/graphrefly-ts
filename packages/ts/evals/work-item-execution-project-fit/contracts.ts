export type D686Category =
	| "dependency-rich-fan-out-fan-in"
	| "failed-prerequisite-independent-branch-join"
	| "provenance-and-fault-governance"
	| "simple-linear-negative-control";

export type D686Arm = "default-recipe" | "manual-graphrefly" | "plain-typescript";

export interface D686Member {
	readonly memberId: string;
	readonly dependsOnMemberIds: readonly string[];
	readonly required: boolean;
	readonly outcome: "completed" | "failed";
}

export interface D686Scenario {
	readonly scenarioId: string;
	readonly category: D686Category;
	readonly members: readonly D686Member[];
	readonly injectProvenanceFaults: boolean;
}

export interface D686PathObservation {
	readonly arm: D686Arm;
	readonly scenarioId: string;
	readonly category: D686Category;
	readonly admittedMemberIds: readonly string[];
	readonly admissionTrace: readonly {
		readonly memberId: string;
		readonly prerequisiteStatuses: Readonly<Record<string, "completed" | "failed">>;
	}[];
	readonly issuedRequestIds: readonly string[];
	readonly requestBindings: readonly {
		readonly memberId: string;
		readonly effectRunId: string;
		readonly requestId: string;
		readonly operationId: string;
	}[];
	readonly completedMemberIds: readonly string[];
	readonly failedMemberIds: readonly string[];
	readonly blockedMemberIds: readonly string[];
	readonly rejectionCodes: readonly string[];
	readonly terminalStatus: "succeeded" | "failed";
	readonly provenanceAuthority: "caller-owned-shared-graph-harness" | "plain-typescript-arm";
	readonly topology: {
		readonly nodeCount: number;
		readonly edgeCount: number;
		readonly namedNodeCount: number;
	} | null;
}

export const D686_SCENARIOS: readonly D686Scenario[] = Object.freeze([
	Object.freeze({
		scenarioId: "d686-dependency-rich-base",
		category: "dependency-rich-fan-out-fan-in",
		injectProvenanceFaults: false,
		members: Object.freeze([
			Object.freeze({
				memberId: "load",
				dependsOnMemberIds: Object.freeze([]),
				required: true,
				outcome: "completed",
			}),
			Object.freeze({
				memberId: "left",
				dependsOnMemberIds: Object.freeze(["load"]),
				required: true,
				outcome: "completed",
			}),
			Object.freeze({
				memberId: "right",
				dependsOnMemberIds: Object.freeze(["load"]),
				required: true,
				outcome: "completed",
			}),
			Object.freeze({
				memberId: "join",
				dependsOnMemberIds: Object.freeze(["left", "right"]),
				required: true,
				outcome: "completed",
			}),
		]),
	}),
	Object.freeze({
		scenarioId: "d686-dependency-rich-extension",
		category: "dependency-rich-fan-out-fan-in",
		injectProvenanceFaults: false,
		members: Object.freeze([
			Object.freeze({
				memberId: "load",
				dependsOnMemberIds: Object.freeze([]),
				required: true,
				outcome: "completed",
			}),
			Object.freeze({
				memberId: "left",
				dependsOnMemberIds: Object.freeze(["load"]),
				required: true,
				outcome: "completed",
			}),
			Object.freeze({
				memberId: "right",
				dependsOnMemberIds: Object.freeze(["load"]),
				required: true,
				outcome: "completed",
			}),
			Object.freeze({
				memberId: "audit",
				dependsOnMemberIds: Object.freeze(["load"]),
				required: true,
				outcome: "completed",
			}),
			Object.freeze({
				memberId: "join",
				dependsOnMemberIds: Object.freeze(["left", "right", "audit"]),
				required: true,
				outcome: "completed",
			}),
		]),
	}),
	Object.freeze({
		scenarioId: "d686-failed-prerequisite",
		category: "failed-prerequisite-independent-branch-join",
		injectProvenanceFaults: false,
		members: Object.freeze([
			Object.freeze({
				memberId: "root",
				dependsOnMemberIds: Object.freeze([]),
				required: true,
				outcome: "completed",
			}),
			Object.freeze({
				memberId: "failing",
				dependsOnMemberIds: Object.freeze(["root"]),
				required: true,
				outcome: "failed",
			}),
			Object.freeze({
				memberId: "independent",
				dependsOnMemberIds: Object.freeze([]),
				required: false,
				outcome: "completed",
			}),
			Object.freeze({
				memberId: "join",
				dependsOnMemberIds: Object.freeze(["failing", "independent"]),
				required: true,
				outcome: "completed",
			}),
		]),
	}),
	Object.freeze({
		scenarioId: "d686-provenance-faults",
		category: "provenance-and-fault-governance",
		injectProvenanceFaults: true,
		members: Object.freeze([
			Object.freeze({
				memberId: "root",
				dependsOnMemberIds: Object.freeze([]),
				required: true,
				outcome: "completed",
			}),
		]),
	}),
	Object.freeze({
		scenarioId: "d686-linear-control",
		category: "simple-linear-negative-control",
		injectProvenanceFaults: false,
		members: Object.freeze([
			Object.freeze({
				memberId: "first",
				dependsOnMemberIds: Object.freeze([]),
				required: true,
				outcome: "completed",
			}),
			Object.freeze({
				memberId: "second",
				dependsOnMemberIds: Object.freeze(["first"]),
				required: true,
				outcome: "completed",
			}),
		]),
	}),
]);
