import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { RuntimeRetentionTrackedValue } from "./agent-runtime-adapter-retention.js";
import { RuntimeRetentionIndex } from "./agent-runtime-adapter-retention.js";
import type { AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type { AgentRequestStatusChanged, ExecutorOutcome } from "./agent-runtime-types-core.js";
import type {
	ToolProviderAdapterExecutionRetentionEntry,
	ToolProviderAdapterInput,
	ToolProviderAdapterInputRetentionEntry,
	ToolProviderAdapterRunIssueRetentionEntry,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunRequestRetentionEntry,
	ToolProviderAdapterRunStatus,
	ToolProviderAdapterRunStatusRetentionEntry,
	ToolProviderAdapterRuntimeRetentionEvidenceEntry,
	ToolProviderAdapterRuntimeStatus,
} from "./agent-runtime-types-tool.js";

export function createAdapterRuntimeRetentionIndexes<TArguments>() {
	return {
		adapterInputs: new RuntimeRetentionIndex<
			ToolProviderAdapterInputRetentionEntry,
			ToolProviderAdapterInput<TArguments>
		>(),
		runRequests: new RuntimeRetentionIndex<
			ToolProviderAdapterRunRequestRetentionEntry,
			RuntimeRetentionTrackedValue<ToolProviderAdapterRunRequested>
		>(),
		executions: new RuntimeRetentionIndex<
			ToolProviderAdapterExecutionRetentionEntry,
			ToolProviderAdapterRunRequested
		>(),
		runStatuses: new RuntimeRetentionIndex<
			ToolProviderAdapterRunStatusRetentionEntry,
			RuntimeRetentionTrackedValue<ToolProviderAdapterRunStatus>
		>(),
		runIssues: new RuntimeRetentionIndex<
			ToolProviderAdapterRunIssueRetentionEntry,
			RuntimeRetentionTrackedValue<DataIssue>
		>(),
		retentionEvidence: new RuntimeRetentionIndex<
			ToolProviderAdapterRuntimeRetentionEvidenceEntry,
			ToolProviderAdapterRuntimeRetentionEvidenceEntry
		>(),
		closedRetentionEvidence: new RuntimeRetentionIndex<
			ToolProviderAdapterRuntimeRetentionEvidenceEntry,
			ToolProviderAdapterRuntimeRetentionEvidenceEntry
		>(),
	};
}

export function createAdapterRuntimeOutputNodes(graph: Graph, name: string) {
	return {
		outcomes: graph.node<ExecutorOutcome>([], null, {
			name: `${name}/outcomes`,
			factory: "toolProviderAdapterRuntimeOutcomes",
		}),
		runStatus: graph.node<ToolProviderAdapterRunStatus>([], null, {
			name: `${name}/runStatus`,
			factory: "toolProviderAdapterRuntimeRunStatus",
		}),
		status: graph.node<AgentRequestStatusChanged>([], null, {
			name: `${name}/status`,
			factory: "toolProviderAdapterRuntimeStatus",
		}),
		runtimeStatus: graph.node<ToolProviderAdapterRuntimeStatus>([], null, {
			name: `${name}/runtimeStatus`,
			factory: "toolProviderAdapterRuntimeStatus",
		}),
		issues: graph.node<DataIssue>([], null, {
			name: `${name}/issues`,
			factory: "toolProviderAdapterRuntimeIssues",
		}),
		audit: graph.node<AgentRuntimeAuditRecord>([], null, {
			name: `${name}/audit`,
			factory: "toolProviderAdapterRuntimeAudit",
		}),
	};
}
