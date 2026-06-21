/**
 * Focused Layer C tool-provider runtime adapter surface (D283/D359-D362).
 *
 * Provider-neutral tool facts and projectors stay in orchestration. This
 * subpath exposes the runtime binding boundary that may close over clients,
 * credentials, subprocess access, transports, SDK objects, or environment
 * handles without making them graph DATA.
 */

export { attachToolProviderAdapterRuntime } from "../orchestration/agent-runtime-adapter-runtime.js";
export type {
	ToolProviderAdapterBinding,
	ToolProviderAdapterExecutionRetentionEntry,
	ToolProviderAdapterInputRetentionEntry,
	ToolProviderAdapterRunContext,
	ToolProviderAdapterRunIssueRetentionEntry,
	ToolProviderAdapterRunRequestRetentionEntry,
	ToolProviderAdapterRunResult,
	ToolProviderAdapterRunStatusRetentionEntry,
	ToolProviderAdapterRuntimeHandle,
	ToolProviderAdapterRuntimeIndexRetentionPolicy,
	ToolProviderAdapterRuntimeOptions,
	ToolProviderAdapterRuntimeRetentionEvidenceEntry,
	ToolProviderAdapterRuntimeRetentionIndex,
	ToolProviderAdapterRuntimeRetentionOrder,
	ToolProviderAdapterRuntimeRetentionPolicy,
	ToolProviderAdapterRuntimeStatus,
	ToolProviderAdapterRuntimeStatusKind,
	ToolProviderPublicTextPolicy,
} from "../orchestration/agent-runtime-types-tool.js";
