/**
 * Optional Layer C tool-provider execution recipe (D283/D359-D362).
 *
 * This module composes the provider-neutral catalog/policy/input projectors
 * with the runtime-private adapter binding boundary. It does not provide
 * concrete bash, filesystem, URL, MCP, CLI, Composio, or SDK bindings.
 */

import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { executorOutcomeViewProjector } from "../orchestration/agent-runtime-outcome-view.js";
import { toolProviderAdapterInputProjector } from "../orchestration/agent-runtime-tool-provider-input.js";
import { toolProviderPolicyResolutionProjector } from "../orchestration/agent-runtime-tool-provider-policy.js";
import type { AgentRuntimeAuditRecord } from "../orchestration/agent-runtime-types-agent.js";
import type {
	AgentRequestFact,
	AgentRequestStatusChanged,
	ExecutorOutcome,
	ExecutorRoute,
} from "../orchestration/agent-runtime-types-core.js";
import type {
	ExecutorOutcomeViewBundle,
	ExecutorOutcomeViewPolicy,
	ToolProviderAdapterInputBundle,
	ToolProviderAdapterRunRequested,
	ToolProviderCatalog,
	ToolProviderPolicyResolutionBundle,
} from "../orchestration/agent-runtime-types-tool.js";
import {
	attachToolProviderAdapterRuntime,
	type ToolProviderAdapterBinding,
	type ToolProviderAdapterRuntimeHandle,
	type ToolProviderAdapterRuntimeRetentionPolicy,
	type ToolProviderPublicTextPolicy,
} from "./tool-provider-runtime.js";

export interface ToolProviderExecutionRecipeOptions<TArguments = unknown, TResult = unknown> {
	readonly name?: string;
	readonly requestFacts: Node<AgentRequestFact>;
	readonly executorRoutes?: readonly Node<ExecutorRoute>[];
	readonly toolProviderCatalogs?: readonly Node<ToolProviderCatalog>[];
	readonly catalogs?: readonly ToolProviderCatalog[];
	readonly bindings:
		| readonly ToolProviderAdapterBinding<TArguments, TResult>[]
		| ReadonlyMap<string, ToolProviderAdapterBinding<TArguments, TResult>>;
	readonly runRequests?: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly autoRunReadyInputs?: boolean;
	readonly retention?: ToolProviderAdapterRuntimeRetentionPolicy;
	readonly now?: () => number;
	readonly publicText?: ToolProviderPublicTextPolicy;
	readonly outcomeViewPolicy?: ExecutorOutcomeViewPolicy;
}

export interface ToolProviderExecutionRecipeBundle {
	readonly catalogs?: Node<ToolProviderCatalog>;
	readonly policy: ToolProviderPolicyResolutionBundle;
	readonly adapterInputs: ToolProviderAdapterInputBundle;
	readonly runtime: ToolProviderAdapterRuntimeHandle;
	readonly outcomeViews: ExecutorOutcomeViewBundle;
	readonly outcomes: Node<ExecutorOutcome>;
	readonly status: Node<AgentRequestStatusChanged>;
	readonly issues: {
		readonly policy: Node<DataIssue>;
		readonly adapterInputs: Node<DataIssue>;
		readonly runtime: Node<DataIssue>;
		readonly outcomeViews: Node<DataIssue>;
	};
	readonly audit: {
		readonly policy: Node<AgentRuntimeAuditRecord>;
		readonly adapterInputs: Node<AgentRuntimeAuditRecord>;
		readonly runtime: Node<AgentRuntimeAuditRecord>;
		readonly outcomeViews: Node<AgentRuntimeAuditRecord>;
	};
	dispose(): void;
}

/**
 * Creates a tool provider execution recipe.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category executors
 * @example
 * ```ts
 * import { toolProviderExecutionRecipe } from "@graphrefly/ts/executors/tool-provider";
 * ```
 */
export function toolProviderExecutionRecipe<TArguments = unknown, TResult = unknown>(
	graph: Graph,
	opts: ToolProviderExecutionRecipeOptions<TArguments, TResult>,
): ToolProviderExecutionRecipeBundle {
	const name = opts.name ?? "toolProviderExecution";
	const staticCatalogs = staticToolProviderCatalogNode(graph, name, opts.catalogs);
	const catalogDeps = [
		...(staticCatalogs === undefined ? [] : [staticCatalogs]),
		...(opts.toolProviderCatalogs ?? []),
	];
	const policy = toolProviderPolicyResolutionProjector(graph, {
		name: `${name}/policy`,
		requestFacts: opts.requestFacts,
		executorRoutes: opts.executorRoutes,
		toolProviderCatalogs: catalogDeps,
	});
	const adapterInputs = toolProviderAdapterInputProjector(graph, {
		name: `${name}/adapterInput`,
		requestFacts: opts.requestFacts,
		executorRoutes: opts.executorRoutes,
		toolProviderCatalogs: catalogDeps,
		policyResolutions: [policy.resolutions],
	});
	const runtime = attachToolProviderAdapterRuntime(graph, {
		name: `${name}/runtime`,
		inputs: adapterInputs.inputs,
		runRequests: opts.runRequests,
		bindings: opts.bindings,
		autoRunReadyInputs: opts.autoRunReadyInputs,
		retention: opts.retention,
		now: opts.now,
		publicText: opts.publicText,
	});
	const outcomeViews = executorOutcomeViewProjector(graph, {
		name: `${name}/outcomeView`,
		outcomes: runtime.outcomes,
		policy: opts.outcomeViewPolicy,
	});
	return {
		...(staticCatalogs === undefined ? {} : { catalogs: staticCatalogs }),
		policy,
		adapterInputs,
		runtime,
		outcomeViews,
		outcomes: runtime.outcomes,
		status: runtime.status,
		issues: {
			policy: policy.issues,
			adapterInputs: adapterInputs.issues,
			runtime: runtime.issues,
			outcomeViews: outcomeViews.issues,
		},
		audit: {
			policy: policy.audit,
			adapterInputs: adapterInputs.audit,
			runtime: runtime.audit,
			outcomeViews: outcomeViews.audit,
		},
		dispose: () => runtime.dispose(),
	};
}

function staticToolProviderCatalogNode(
	graph: Graph,
	name: string,
	catalogs: readonly ToolProviderCatalog[] | undefined,
): Node<ToolProviderCatalog> | undefined {
	if (catalogs === undefined || catalogs.length === 0) return undefined;
	return graph.producer<ToolProviderCatalog>(
		(ctx) => {
			ctx.down(catalogs.map((catalog) => ["DATA", catalog] as const));
		},
		{ name: `${name}/catalogs`, factory: "toolProviderExecutionCatalogs" },
	);
}
