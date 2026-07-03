import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import {
	dataIssue,
	forbiddenAdapterInputMaterialIssues,
	forEachDepBatch,
	projectRuntimeFact,
	ref,
	sanitizeAdapterInputIssue,
	sanitizeAdapterInputSourceRefs,
	stableJsonStringify,
} from "./agent-runtime-common.js";
import {
	toolCallFromRequest,
	validateToolProviderExecutionPolicy,
	validateToolProviderPolicyProviderScope,
} from "./agent-runtime-tool-provider-policy.js";
import type { AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type {
	AgentRequestFact,
	AgentRequestInput,
	AgentRequestIssued,
	ExecutorRoute,
	SourceRef,
} from "./agent-runtime-types-core.js";
import type {
	ToolCallInput,
	ToolProviderAdapterInput,
	ToolProviderAdapterInputBundle,
	ToolProviderAdapterInputStatus,
	ToolProviderCatalog,
	ToolProviderCatalogEntry,
	ToolProviderExecutionPolicy,
	ToolProviderPolicyResolution,
} from "./agent-runtime-types-tool.js";

export function buildToolProviderAdapterInputs(opts: {
	readonly requests: readonly AgentRequestIssued[];
	readonly routes?: readonly ExecutorRoute[];
	readonly catalogs?: readonly ToolProviderCatalog[];
	readonly resolutions: readonly ToolProviderPolicyResolution[];
}): readonly ToolProviderAdapterInput[] {
	const requestsById = new Map(opts.requests.map((request) => [request.requestId, request]));
	const routesById = new Map((opts.routes ?? []).map((route) => [route.routeId, route]));
	const catalogsById = new Map(
		(opts.catalogs ?? []).map((catalog) => [catalog.providerId, catalog]),
	);
	return Object.freeze(
		opts.resolutions.map((resolution) =>
			buildToolProviderAdapterInput({
				resolution,
				request: requestsById.get(resolution.requestId),
				route: resolution.routeId === undefined ? undefined : routesById.get(resolution.routeId),
				catalog:
					resolution.providerId === undefined ? undefined : catalogsById.get(resolution.providerId),
			}),
		),
	);
}

export function toolProviderAdapterInputProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly requestFacts: Node<AgentRequestFact>;
		readonly executorRoutes?: readonly Node<ExecutorRoute>[];
		readonly toolProviderCatalogs?: readonly Node<ToolProviderCatalog>[];
		readonly policyResolutions: readonly Node<ToolProviderPolicyResolution>[];
	},
): ToolProviderAdapterInputBundle {
	const name = opts.name ?? "toolProviderAdapterInput";
	const routeDeps = opts.executorRoutes ?? [];
	const catalogDeps = opts.toolProviderCatalogs ?? [];
	const routeStart = 1;
	const catalogStart = routeStart + routeDeps.length;
	const resolutionStart = catalogStart + catalogDeps.length;
	const runtime = graph.node<ToolProviderAdapterInputFact>(
		[opts.requestFacts, ...routeDeps, ...catalogDeps, ...opts.policyResolutions],
		(ctx) => {
			const state = ctx.state.get<ToolProviderAdapterInputState>() ?? {
				requests: new Map<string, AgentRequestIssued>(),
				routes: new Map<string, ExecutorRoute>(),
				catalogs: new Map<string, ToolProviderCatalog>(),
				resolutions: new Map<string, ToolProviderPolicyResolution>(),
				emittedKeys: new Set<string>(),
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "issued" && fact.input?.inputKind === "tool-call") {
					state.requests.set(fact.requestId, fact);
				}
			}
			forEachDepBatch(ctx, routeStart, routeDeps.length, (raw) => {
				const route = raw as ExecutorRoute;
				state.routes.set(route.routeId, route);
			});
			forEachDepBatch(ctx, catalogStart, catalogDeps.length, (raw) => {
				const catalog = raw as ToolProviderCatalog;
				state.catalogs.set(catalog.providerId, catalog);
			});
			forEachDepBatch(ctx, resolutionStart, opts.policyResolutions.length, (raw) => {
				const resolution = raw as ToolProviderPolicyResolution;
				state.resolutions.set(resolution.resolutionId, resolution);
			});
			const inputs = buildToolProviderAdapterInputs({
				requests: Array.from(state.requests.values()),
				routes: Array.from(state.routes.values()),
				catalogs: Array.from(state.catalogs.values()),
				resolutions: Array.from(state.resolutions.values()),
			});
			for (const input of inputs) {
				const key = stableToolProviderAdapterInputKey(input);
				if (state.emittedKeys.has(key)) continue;
				state.emittedKeys.add(key);
				ctx.down([["DATA", { kind: "input", input } satisfies ToolProviderAdapterInputFact]]);
				for (const issue of input.issues ?? []) {
					ctx.down([["DATA", { kind: "issue", issue } satisfies ToolProviderAdapterInputFact]]);
				}
				state.auditSeq += 1;
				ctx.down([
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: compoundTupleKey("tool-provider-adapter-input-audit", [
									name,
									String(state.auditSeq),
								]),
								kind: "tool-provider-adapter-input",
								subjectId: input.requestId,
								sourceRefs: input.sourceRefs,
								metadata: {
									status: input.status,
									routeId: input.routeId,
									providerId: input.providerId,
									profileId: input.profileId,
									toolName: input.toolName,
								},
							},
						} satisfies ToolProviderAdapterInputFact,
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "toolProviderAdapterInputProjector", partial: true },
	);
	const inputs = projectRuntimeFact(
		graph,
		runtime,
		`${name}/inputs`,
		"toolProviderAdapterInputs",
		(fact) => (fact.kind === "input" ? fact.input : undefined),
	);
	const issues = projectRuntimeFact(
		graph,
		runtime,
		`${name}/issues`,
		"toolProviderAdapterInputIssues",
		(fact) => (fact.kind === "issue" ? fact.issue : undefined),
	);
	const audit = projectRuntimeFact(
		graph,
		runtime,
		`${name}/audit`,
		"toolProviderAdapterInputAudit",
		(fact) => (fact.kind === "audit" ? fact.audit : undefined),
	);
	return { inputs, issues, audit };
}

export type ToolProviderAdapterInputFact =
	| { readonly kind: "input"; readonly input: ToolProviderAdapterInput }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export interface ToolProviderAdapterInputState {
	requests: Map<string, AgentRequestIssued>;
	routes: Map<string, ExecutorRoute>;
	catalogs: Map<string, ToolProviderCatalog>;
	resolutions: Map<string, ToolProviderPolicyResolution>;
	emittedKeys: Set<string>;
	auditSeq: number;
}

export function buildToolProviderAdapterInput(opts: {
	readonly resolution: ToolProviderPolicyResolution;
	readonly request?: AgentRequestIssued;
	readonly route?: ExecutorRoute;
	readonly catalog?: ToolProviderCatalog;
}): ToolProviderAdapterInput {
	const { resolution, request, route, catalog } = opts;
	const sourceRefs = sanitizeAdapterInputSourceRefs([
		ref("tool-provider-policy-resolution", resolution.resolutionId),
		...(resolution.sourceRefs ?? []),
		...(resolution.routeId === undefined ? [] : [ref("executor-route", resolution.routeId)]),
		...(resolution.providerId === undefined
			? []
			: [ref("tool-provider-catalog", resolution.providerId)]),
		...(resolution.policyRefs ?? []),
	]);
	const issues: DataIssue[] = (resolution.issues ?? []).map((issue) =>
		sanitizeAdapterInputIssue(issue),
	);
	let statusOverride: Exclude<ToolProviderAdapterInputStatus, "ready"> | undefined;
	if (request === undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-request",
				"Tool provider adapter input requires the issued AgentRequest fact.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (request !== undefined && request.requestId !== resolution.requestId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-request",
				"Tool provider adapter input request identity does not match its policy resolution.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (request !== undefined && request.operationId !== resolution.operationId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-request-operation",
				"Tool provider adapter input request operationId does not match its policy resolution.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (resolution.routeId !== undefined && route === undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-route",
				"Tool provider adapter input requires the selected ExecutorRoute fact.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (route !== undefined) {
		issues.push(...routeIdentityIssuesForAdapterInput(route, resolution, request, sourceRefs));
	}
	if (resolution.providerId !== undefined && catalog === undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-catalog",
				"Tool provider adapter input requires the selected ToolProviderCatalog fact.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (catalog !== undefined && catalog.status !== undefined && catalog.status !== "ready") {
		statusOverride = "invalid-policy";
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-catalog-unavailable",
				"Tool provider adapter input requires a ready ToolProviderCatalog.",
				{
					subjectId: resolution.requestId,
					refs: [...sourceRefs, ref("tool-provider-catalog", catalog.providerId)],
					details: { status: catalog.status },
				},
			),
		);
		issues.push(...(catalog.issues ?? []).map((issue) => sanitizeAdapterInputIssue(issue)));
	}
	const toolCall = request === undefined ? undefined : toolCallFromRequest(request);
	if (request !== undefined && toolCall === undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-tool-call",
				"Tool provider adapter input requires AgentRequest input.value to be a ToolCallInput.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	const tool =
		catalog === undefined || route === undefined || toolCall === undefined
			? undefined
			: selectedToolForAdapterInput(catalog, route, toolCall);
	if (resolution.status === "resolved" && tool === undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-tool",
				"Tool provider adapter input requires the selected catalog tool entry.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	const policies =
		catalog === undefined
			? []
			: selectedPoliciesForAdapterInput(catalog, resolution.policyRefs ?? []);
	if (resolution.status === "resolved" && (resolution.policyRefs?.length ?? 0) === 0) {
		statusOverride = "missing-policy";
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-missing-policy-ref",
				"Ready tool provider adapter input requires at least one D360 policy ref.",
				{ subjectId: resolution.requestId, refs: sourceRefs },
			),
		);
	}
	if (catalog !== undefined) {
		for (const issue of policyMaterialIssuesForAdapterInput(catalog, resolution, sourceRefs)) {
			statusOverride ??= "invalid-policy";
			issues.push(issue);
		}
	}
	for (const policy of policies) {
		issues.push(...validateToolProviderExecutionPolicy(policy));
		if (catalog !== undefined)
			issues.push(...validateToolProviderPolicyProviderScope(policy, catalog.providerId));
	}
	if (request?.input !== undefined) {
		issues.push(
			...forbiddenAdapterInputMaterialIssues(
				request.input,
				ref("agent-request", request.requestId),
				"request-input",
			),
		);
	}
	if (route !== undefined) {
		issues.push(
			...forbiddenAdapterInputMaterialIssues(
				route.allowedParams,
				ref("executor-route", route.routeId),
				"route-allowed-params",
			),
			...forbiddenAdapterInputMaterialIssues(
				route.metadata,
				ref("executor-route", route.routeId),
				"route-metadata",
			),
		);
	}
	if (tool !== undefined) {
		const toolRef = ref("tool", tool.toolName);
		issues.push(
			...forbiddenAdapterInputMaterialIssues(tool.capabilities, toolRef, "tool-capabilities"),
			...forbiddenAdapterInputMaterialIssues(tool.limits, toolRef, "tool-limits"),
			...forbiddenAdapterInputMaterialIssues(tool.metadata, toolRef, "tool-metadata"),
		);
	}
	for (const policy of policies) {
		issues.push(
			...forbiddenAdapterInputMaterialIssues(
				policy,
				ref("tool-provider-execution-policy", policy.policyId),
				"policy-material",
			),
		);
	}
	const status =
		resolution.status === "resolved"
			? issues.length === 0
				? "ready"
				: (statusOverride ?? "invalid-policy")
			: resolution.status;
	const ready = status === "ready";
	const candidate = {
		kind: "tool-provider-adapter-input",
		adapterInputId: compoundTupleKey("tool-provider-adapter-input", [
			resolution.requestId,
			resolution.operationId,
			resolution.routeId ?? resolution.resolutionId,
		]),
		status,
		requestId: resolution.requestId,
		operationId: resolution.operationId,
		effectRunId: request?.effectRunId,
		agentRunId: request?.agentRunId,
		routeId: resolution.routeId,
		providerId: resolution.providerId,
		executorId: resolution.executorId,
		profileId: resolution.profileId,
		toolName: resolution.toolName,
		operation: resolution.operation,
		input: ready ? (request?.input as AgentRequestInput<ToolCallInput> | undefined) : undefined,
		toolCall: ready ? toolCall : undefined,
		route: ready ? route : undefined,
		tool: ready ? tool : undefined,
		policies: ready ? Object.freeze(policies) : undefined,
		policyRefs: sanitizeAdapterInputSourceRefs(resolution.policyRefs ?? []),
		sourceRefs,
		issues: issues.length === 0 ? undefined : Object.freeze(issues),
		metadata: { resolutionId: resolution.resolutionId },
	} satisfies ToolProviderAdapterInput;
	if (ready) {
		const candidateIssues = forbiddenAdapterInputMaterialIssues(
			candidate,
			ref("tool-provider-adapter-input", candidate.adapterInputId),
			"adapter-input",
		);
		if (candidateIssues.length > 0) {
			const blockedIssues = Object.freeze([...issues, ...candidateIssues]);
			return Object.freeze({
				...candidate,
				status: "invalid-policy",
				input: undefined,
				toolCall: undefined,
				route: undefined,
				tool: undefined,
				policies: undefined,
				issues: blockedIssues,
			} satisfies ToolProviderAdapterInput);
		}
	}
	return Object.freeze(candidate);
}

export function selectedToolForAdapterInput(
	catalog: ToolProviderCatalog,
	route: ExecutorRoute,
	toolCall: ToolCallInput,
): ToolProviderCatalogEntry | undefined {
	return catalog.tools.find(
		(entry) =>
			entry.profileId === route.profileId &&
			entry.executorId === route.executorId &&
			entry.toolName === toolCall.toolName &&
			(entry.operation === undefined ||
				toolCall.operation === undefined ||
				entry.operation === toolCall.operation),
	);
}

export function selectedPoliciesForAdapterInput(
	catalog: ToolProviderCatalog,
	policyRefs: readonly SourceRef[],
): ToolProviderExecutionPolicy[] {
	const policiesById = new Map((catalog.policies ?? []).map((policy) => [policy.policyId, policy]));
	const policies: ToolProviderExecutionPolicy[] = [];
	for (const policyRef of policyRefs) {
		if (policyRef.kind !== "tool-provider-execution-policy") continue;
		const policy = policiesById.get(policyRef.id);
		if (policy !== undefined) policies.push(policy);
	}
	return policies;
}

export function routeIdentityIssuesForAdapterInput(
	route: ExecutorRoute,
	resolution: ToolProviderPolicyResolution,
	request: AgentRequestIssued | undefined,
	sourceRefs: readonly SourceRef[],
): readonly DataIssue[] {
	const issues: DataIssue[] = [];
	const refs = [...sourceRefs, ref("executor-route", route.routeId)];
	if (route.requestId !== resolution.requestId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-request",
				"ExecutorRoute requestId does not match the tool provider policy resolution.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (route.operationId !== resolution.operationId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-operation",
				"ExecutorRoute operationId does not match the tool provider policy resolution.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (resolution.routeId !== undefined && route.routeId !== resolution.routeId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-id",
				"ExecutorRoute routeId does not match the tool provider policy resolution.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (resolution.executorId !== undefined && route.executorId !== resolution.executorId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-executor",
				"ExecutorRoute executorId does not match the tool provider policy resolution.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (resolution.profileId !== undefined && route.profileId !== resolution.profileId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-profile",
				"ExecutorRoute profileId does not match the tool provider policy resolution.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (
		request !== undefined &&
		route.inputId !== undefined &&
		route.inputId !== request.input?.inputId
	) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-input",
				"ExecutorRoute inputId does not match the issued AgentRequest input.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (route.inputKind !== undefined && route.inputKind !== "tool-call") {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-invalid-route-input-kind",
				"Tool provider adapter input requires ExecutorRoute.inputKind to be tool-call when present.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	if (
		request !== undefined &&
		route.inputKind !== undefined &&
		request.input?.inputKind !== undefined &&
		route.inputKind !== request.input.inputKind
	) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-input-stale-route-input-kind",
				"ExecutorRoute inputKind does not match the issued AgentRequest input.",
				{ subjectId: resolution.requestId, refs },
			),
		);
	}
	return Object.freeze(issues);
}

export function policyMaterialIssuesForAdapterInput(
	catalog: ToolProviderCatalog,
	resolution: ToolProviderPolicyResolution,
	sourceRefs: readonly SourceRef[],
): readonly DataIssue[] {
	const policiesById = new Map((catalog.policies ?? []).map((policy) => [policy.policyId, policy]));
	const issues: DataIssue[] = [];
	for (const policyRef of resolution.policyRefs ?? []) {
		if (policyRef.kind !== "tool-provider-execution-policy") {
			issues.push(
				dataIssue(
					"tool-provider-adapter-input-invalid-policy-ref-kind",
					"Tool provider adapter input policy refs must point at ToolProviderExecutionPolicy facts.",
					{ subjectId: resolution.requestId, refs: [...sourceRefs, policyRef] },
				),
			);
			continue;
		}
		if (!policiesById.has(policyRef.id)) {
			issues.push(
				dataIssue(
					"tool-provider-adapter-input-policy-ref-missing-material",
					"Tool provider adapter input policy ref has no selected policy material.",
					{ subjectId: resolution.requestId, refs: [...sourceRefs, policyRef] },
				),
			);
		}
	}
	return Object.freeze(issues);
}

export function stableToolProviderAdapterInputKey(input: ToolProviderAdapterInput): string {
	return stableJsonStringify({
		id: input.adapterInputId,
		status: input.status,
		policyRefs:
			input.policyRefs?.map((policyRef) => canonicalTupleKey([policyRef.kind, policyRef.id])) ?? [],
		issues: input.issues?.map((issue) => issue.code) ?? [],
		input,
	});
}
