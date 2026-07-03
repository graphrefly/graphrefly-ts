import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import {
	dataIssue,
	forbiddenDataKeys,
	forbiddenGraphVisibleMaterialIssues,
	forbiddenProviderRawMaterialKeys,
	forEachDepBatch,
	isRecord,
	projectRuntimeFact,
	ref,
	sanitizeProviderGraphVisibleRecord,
	unlockedToolProviderPolicyOverrides,
} from "./agent-runtime-common.js";
import type { AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	ExecutorProfile,
	ExecutorRoute,
	SourceRef,
} from "./agent-runtime-types-core.js";
import type {
	LocalBuiltinToolProviderCatalogOptions,
	ToolCallInput,
	ToolProviderApprovalPolicy,
	ToolProviderArtifactPolicy,
	ToolProviderCatalog,
	ToolProviderCatalogEntry,
	ToolProviderExecutionPolicy,
	ToolProviderFilesystemPolicy,
	ToolProviderNetworkPolicy,
	ToolProviderPathRule,
	ToolProviderPolicyResolution,
	ToolProviderPolicyResolutionBundle,
	ToolProviderPolicyResolutionStatus,
	ToolProviderRedactionPolicy,
	ToolProviderSizeCapacityPolicy,
	ToolProviderSizeLimit,
	ToolProviderTimeoutPolicy,
} from "./agent-runtime-types-tool.js";

export function localBuiltinToolProviderCatalog(
	opts: LocalBuiltinToolProviderCatalogOptions = {},
): ToolProviderCatalog {
	const providerId = opts.providerId ?? "local-builtin";
	const executorId = opts.executorId ?? `${providerId}:tool-executor`;
	const profileId = opts.profileId ?? `${providerId}:tool-profile`;
	const tools =
		opts.tools ??
		([
			{ toolName: "document/read-doc", operation: "read" },
			{ toolName: "file.read", operation: "read" },
			{ toolName: "file.edit/apply-patch", operation: "edit" },
			{ toolName: "bash.run", operation: "run" },
			{ toolName: "url.fetch", operation: "fetch" },
			{ toolName: "date.now", operation: "read" },
			{ toolName: "weather.fetch", operation: "fetch" },
			{ toolName: "calculator/eval", operation: "eval" },
		] satisfies readonly Omit<
			ToolProviderCatalogEntry,
			"kind" | "providerId" | "inputKind" | "profileId" | "executorId"
		>[]);
	const candidatePolicies: readonly unknown[] = opts.policies?.map((policy) =>
		Object.freeze(policy),
	) ?? [
		defaultLocalBuiltinToolProviderExecutionPolicy({
			providerId,
			profileId,
			tools,
			overrides: opts.policyOverrides,
		}),
	];
	const policyIssues = Object.freeze(
		candidatePolicies.flatMap((policy) => [
			...validateToolProviderExecutionPolicy(policy),
			...validateToolProviderPolicyProviderScope(policy, providerId),
		]),
	);
	const policies = Object.freeze(
		candidatePolicies
			.filter((policy) => isPublishableToolProviderExecutionPolicy(policy, providerId))
			.map((policy) => Object.freeze(policy)),
	);
	const policyRefs = Object.freeze(
		policies.map((policy) => ref("tool-provider-execution-policy", policy.policyId)),
	);
	const catalogInputIssues = Object.freeze([
		...forbiddenGraphVisibleMaterialIssues(
			opts.metadata,
			ref("tool-provider-catalog", providerId),
			"catalog-metadata",
		),
		...forbiddenGraphVisibleMaterialIssues(
			opts.capabilities,
			ref("executor-profile", profileId),
			"profile-capabilities",
		),
		...forbiddenGraphVisibleMaterialIssues(
			opts.limits,
			ref("executor-profile", profileId),
			"profile-limits",
		),
		...tools.flatMap((tool) => [
			...forbiddenGraphVisibleMaterialIssues(
				tool.metadata,
				ref("tool", tool.toolName),
				"tool-metadata",
			),
			...forbiddenGraphVisibleMaterialIssues(
				tool.capabilities,
				ref("tool", tool.toolName),
				"tool-capabilities",
			),
			...forbiddenGraphVisibleMaterialIssues(
				tool.limits,
				ref("tool", tool.toolName),
				"tool-limits",
			),
		]),
	]);
	const toolEntries = tools.map((tool) => {
		const toolPolicyRefs = policyRefsForTool(policies, profileId, tool);
		return Object.freeze({
			...tool,
			kind: "tool-catalog-entry",
			providerId,
			inputKind: "tool-call",
			profileId,
			executorId,
			capabilities: sanitizeProviderGraphVisibleRecord(tool.capabilities),
			limits: sanitizeProviderGraphVisibleRecord(tool.limits),
			policyRefs: toolPolicyRefs,
			metadata: sanitizeProviderGraphVisibleRecord(tool.metadata),
		} satisfies ToolProviderCatalogEntry);
	});
	const profilePolicyRefs = policyRefsForProfile(policies, profileId);
	const issues = Object.freeze([...policyIssues, ...catalogInputIssues]);
	return Object.freeze({
		kind: "tool-provider-catalog",
		providerId,
		providerKind: "local-builtin",
		status: issues.length === 0 ? "ready" : "misconfigured",
		profiles: Object.freeze([
			Object.freeze({
				profileId,
				executorId,
				kind: "tool",
				acceptedInputKinds: Object.freeze(["tool-call"]),
				acceptedResultKinds: Object.freeze(
					Array.from(new Set(toolEntries.flatMap((tool) => tool.resultKinds ?? []))),
				),
				capabilities: Object.freeze({
					toolNames: Object.freeze(toolEntries.map((tool) => tool.toolName)),
					...(sanitizeProviderGraphVisibleRecord(opts.capabilities) ?? {}),
				}),
				limits: sanitizeProviderGraphVisibleRecord(opts.limits),
				policyRefs: profilePolicyRefs,
				metadata: sanitizeProviderGraphVisibleRecord(opts.metadata),
			} satisfies ExecutorProfile),
		]),
		tools: Object.freeze(toolEntries),
		policies,
		policyRefs,
		issues: issues.length === 0 ? undefined : issues,
		metadata: sanitizeProviderGraphVisibleRecord(opts.metadata),
	});
}

export function validateToolProviderExecutionPolicy(policy: unknown): readonly DataIssue[] {
	const issues: DataIssue[] = [];
	if (!isRecord(policy)) {
		return Object.freeze([
			dataIssue(
				"tool-provider-policy-invalid-shape",
				"Tool provider policy must be a data object.",
				{ refs: [ref("tool-provider-execution-policy", "<invalid>")] },
			),
		]);
	}
	const policyId = typeof policy.policyId === "string" ? policy.policyId : "";
	const providerId = typeof policy.providerId === "string" ? policy.providerId : "";
	const policyRef = ref("tool-provider-execution-policy", policyId || "<missing>");
	if (policy.kind !== "tool-provider-execution-policy") {
		issues.push(
			dataIssue(
				"tool-provider-policy-invalid-kind",
				"ToolProviderExecutionPolicy.kind must be tool-provider-execution-policy.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	if (!policyId) {
		issues.push(
			dataIssue(
				"tool-provider-policy-missing-policy-id",
				"Tool provider policy is missing policyId.",
				{
					refs: [policyRef],
				},
			),
		);
	}
	if (!providerId) {
		issues.push(
			dataIssue(
				"tool-provider-policy-missing-provider-id",
				"Tool provider policy is missing providerId.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	if (
		policy.sizeCapacity === undefined &&
		policy.timeout === undefined &&
		policy.redaction === undefined &&
		policy.filesystem === undefined &&
		policy.approval === undefined &&
		policy.artifacts === undefined &&
		policy.network === undefined
	) {
		issues.push(
			dataIssue(
				"tool-provider-policy-missing-material",
				"Tool provider policy has no D360 policy material sections.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	if (policy.sizeCapacity !== undefined && !isRecord(policy.sizeCapacity)) {
		issues.push(
			dataIssue(
				"tool-provider-policy-invalid-size-capacity",
				"Tool provider size-capacity policy must be a data object.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	const limits = isRecord(policy.sizeCapacity) ? policy.sizeCapacity.limits : undefined;
	if (isRecord(policy.sizeCapacity) && !Array.isArray(limits)) {
		issues.push(
			dataIssue(
				"tool-provider-policy-invalid-size-capacity",
				"Tool provider size-capacity limits must be an array.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	for (const [index, rawLimit] of (Array.isArray(limits) ? limits : []).entries()) {
		if (!isRecord(rawLimit)) {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-size-limit",
					"Tool provider size-capacity limit must be a data object.",
					{ subjectId: policyId, refs: [policyRef], details: { index } },
				),
			);
			continue;
		}
		const limit = rawLimit as Partial<ToolProviderSizeLimit>;
		if (typeof limit.unit !== "string" || limit.unit.length === 0) {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-size-limit",
					"Tool provider size-capacity limit unit must be a non-empty string.",
					{ subjectId: policyId, refs: [policyRef], details: { index } },
				),
			);
		}
		if (
			limit.softLimit !== undefined &&
			(typeof limit.softLimit !== "number" ||
				!Number.isFinite(limit.softLimit) ||
				limit.softLimit < 0)
		) {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-size-limit",
					"Tool provider size-capacity softLimit must be a finite non-negative number.",
					{ subjectId: policyId, refs: [policyRef], details: { index, unit: limit.unit } },
				),
			);
		}
		if (
			limit.hardLimit !== undefined &&
			(typeof limit.hardLimit !== "number" ||
				!Number.isFinite(limit.hardLimit) ||
				limit.hardLimit < 0)
		) {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-size-limit",
					"Tool provider size-capacity hardLimit must be a finite non-negative number.",
					{ subjectId: policyId, refs: [policyRef], details: { index, unit: limit.unit } },
				),
			);
		}
		if (
			typeof limit.softLimit === "number" &&
			Number.isFinite(limit.softLimit) &&
			typeof limit.hardLimit === "number" &&
			Number.isFinite(limit.hardLimit) &&
			limit.softLimit > limit.hardLimit
		) {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-size-limit",
					"Tool provider size-capacity softLimit must not exceed hardLimit.",
					{ subjectId: policyId, refs: [policyRef], details: { index, unit: limit.unit } },
				),
			);
		}
	}
	if (policy.timeout !== undefined && !isRecord(policy.timeout)) {
		issues.push(
			dataIssue(
				"tool-provider-policy-invalid-timeout",
				"Tool provider timeout policy must be a data object.",
				{ subjectId: policyId, refs: [policyRef] },
			),
		);
	}
	for (const [field, value] of Object.entries(isRecord(policy.timeout) ? policy.timeout : {})) {
		if (field.endsWith("TimeoutMs") || field === "timeoutMs") {
			if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
				issues.push(
					dataIssue(
						"tool-provider-policy-invalid-timeout",
						"Tool provider timeout values must be finite non-negative numbers.",
						{ subjectId: policyId, refs: [policyRef], details: { field } },
					),
				);
			}
		}
	}
	for (const forbidden of [
		...forbiddenDataKeys(policy),
		...forbiddenProviderRawMaterialKeys(policy),
	]) {
		issues.push(
			dataIssue(
				"tool-provider-policy-forbidden-runtime-material",
				"Tool provider policy must not contain runtime-private adapter material.",
				{ subjectId: policyId, refs: [policyRef], details: { reason: forbidden.reason } },
			),
		);
	}
	return Object.freeze(issues);
}

export function resolveToolProviderExecutionPolicies(opts: {
	readonly request: AgentRequestIssued;
	readonly routes?: readonly ExecutorRoute[];
	readonly catalogs?: readonly ToolProviderCatalog[];
}): readonly ToolProviderPolicyResolution[] {
	const request = opts.request;
	const toolCall = toolCallFromRequest(request);
	const baseSourceRefs = Object.freeze([ref("agent-request", request.requestId)]);
	if (toolCall === undefined) {
		return Object.freeze([
			Object.freeze({
				kind: "tool-provider-policy-resolution",
				resolutionId: compoundTupleKey("tool-provider-policy-resolution", [
					request.requestId,
					request.operationId,
					"missing-tool-call",
				]),
				status: "missing-tool-call",
				requestId: request.requestId,
				operationId: request.operationId,
				issues: Object.freeze([
					dataIssue(
						"tool-provider-policy-missing-tool-call",
						"Tool provider policy resolution requires AgentRequest input.value to be a ToolCallInput.",
						{ subjectId: request.requestId, refs: baseSourceRefs },
					),
				]),
				sourceRefs: baseSourceRefs,
			} satisfies ToolProviderPolicyResolution),
		]);
	}
	const routes = (opts.routes ?? []).filter(
		(route) => route.requestId === request.requestId && route.operationId === request.operationId,
	);
	if (routes.length === 0) {
		return Object.freeze([
			Object.freeze({
				kind: "tool-provider-policy-resolution",
				resolutionId: compoundTupleKey("tool-provider-policy-resolution", [
					request.requestId,
					request.operationId,
					"pending-route",
				]),
				status: "pending-route",
				requestId: request.requestId,
				operationId: request.operationId,
				toolName: toolCall.toolName,
				operation: toolCall.operation,
				sourceRefs: baseSourceRefs,
			} satisfies ToolProviderPolicyResolution),
		]);
	}
	return Object.freeze(
		routes.map((route) =>
			Object.freeze(
				resolveToolProviderPolicyForRoute(request, route, toolCall, opts.catalogs ?? []),
			),
		),
	);
}

export function toolProviderPolicyResolutionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly requestFacts: Node<AgentRequestFact>;
		readonly executorRoutes?: readonly Node<ExecutorRoute>[];
		readonly toolProviderCatalogs?: readonly Node<ToolProviderCatalog>[];
	},
): ToolProviderPolicyResolutionBundle {
	const name = opts.name ?? "toolProviderPolicyResolution";
	const routeDeps = opts.executorRoutes ?? [];
	const catalogDeps = opts.toolProviderCatalogs ?? [];
	const routeStart = 1;
	const catalogStart = routeStart + routeDeps.length;
	const runtime = graph.node<ToolProviderPolicyResolutionFact>(
		[opts.requestFacts, ...routeDeps, ...catalogDeps],
		(ctx) => {
			const state = ctx.state.get<ToolProviderPolicyResolutionState>() ?? {
				requests: new Map<string, AgentRequestIssued>(),
				routes: new Map<string, ExecutorRoute>(),
				catalogs: new Map<string, ToolProviderCatalog>(),
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
			for (const request of state.requests.values()) {
				const resolutions = resolveToolProviderExecutionPolicies({
					request,
					routes: Array.from(state.routes.values()),
					catalogs: Array.from(state.catalogs.values()),
				});
				for (const resolution of resolutions) {
					const key = stableToolProviderPolicyResolutionKey(resolution);
					if (state.emittedKeys.has(key)) continue;
					state.emittedKeys.add(key);
					ctx.down([
						["DATA", { kind: "resolution", resolution } satisfies ToolProviderPolicyResolutionFact],
					]);
					for (const issue of resolution.issues ?? []) {
						ctx.down([
							["DATA", { kind: "issue", issue } satisfies ToolProviderPolicyResolutionFact],
						]);
					}
					state.auditSeq += 1;
					ctx.down([
						[
							"DATA",
							{
								kind: "audit",
								audit: {
									id: compoundTupleKey("tool-provider-policy-audit", [
										name,
										String(state.auditSeq),
									]),
									kind: "tool-provider-policy-resolution",
									subjectId: request.requestId,
									sourceRefs: resolution.sourceRefs,
									metadata: {
										status: resolution.status,
										routeId: resolution.routeId,
										providerId: resolution.providerId,
										profileId: resolution.profileId,
										toolName: resolution.toolName,
									},
								},
							} satisfies ToolProviderPolicyResolutionFact,
						],
					]);
				}
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "toolProviderPolicyResolutionProjector", partial: true },
	);
	const resolutions = projectRuntimeFact(
		graph,
		runtime,
		`${name}/resolutions`,
		"toolProviderPolicyResolutions",
		(fact) => (fact.kind === "resolution" ? fact.resolution : undefined),
	);
	const issues = projectRuntimeFact(
		graph,
		runtime,
		`${name}/issues`,
		"toolProviderPolicyResolutionIssues",
		(fact) => (fact.kind === "issue" ? fact.issue : undefined),
	);
	const audit = projectRuntimeFact(
		graph,
		runtime,
		`${name}/audit`,
		"toolProviderPolicyResolutionAudit",
		(fact) => (fact.kind === "audit" ? fact.audit : undefined),
	);
	return { resolutions, issues, audit };
}

export type ToolProviderPolicyResolutionFact =
	| { readonly kind: "resolution"; readonly resolution: ToolProviderPolicyResolution }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export interface ToolProviderPolicyResolutionState {
	requests: Map<string, AgentRequestIssued>;
	routes: Map<string, ExecutorRoute>;
	catalogs: Map<string, ToolProviderCatalog>;
	emittedKeys: Set<string>;
	auditSeq: number;
}

export function isPublishableToolProviderExecutionPolicy(
	policy: unknown,
	providerId?: string,
): policy is ToolProviderExecutionPolicy {
	return (
		isRecord(policy) &&
		policy.kind === "tool-provider-execution-policy" &&
		typeof policy.policyId === "string" &&
		policy.policyId.length > 0 &&
		typeof policy.providerId === "string" &&
		policy.providerId.length > 0 &&
		(providerId === undefined || policy.providerId === providerId) &&
		validateToolProviderExecutionPolicy(policy).length === 0
	);
}

export function validateToolProviderPolicyProviderScope(
	policy: unknown,
	providerId: string,
): readonly DataIssue[] {
	if (!isRecord(policy)) return [];
	if (policy.providerId === undefined || policy.providerId === providerId) return [];
	return Object.freeze([
		dataIssue(
			"tool-provider-policy-provider-mismatch",
			"Tool provider policy providerId must match the catalog providerId.",
			{
				subjectId: typeof policy.policyId === "string" ? policy.policyId : undefined,
				refs: [
					ref(
						"tool-provider-execution-policy",
						typeof policy.policyId === "string" && policy.policyId.length > 0
							? policy.policyId
							: "<missing>",
					),
					ref("tool-provider-catalog", providerId),
				],
			},
		),
	]);
}

export function policyRefsForProfile(
	policies: readonly ToolProviderExecutionPolicy[],
	profileId: string,
): readonly SourceRef[] {
	return Object.freeze(
		policies
			.filter((policy) => policyAppliesToProfile(policy, profileId))
			.map((policy) => ref("tool-provider-execution-policy", policy.policyId)),
	);
}

export function policyRefsForTool(
	policies: readonly ToolProviderExecutionPolicy[],
	profileId: string,
	tool: Omit<
		ToolProviderCatalogEntry,
		"kind" | "providerId" | "inputKind" | "profileId" | "executorId"
	>,
): readonly SourceRef[] {
	return Object.freeze(
		policies
			.filter((policy) => policyAppliesToProfile(policy, profileId))
			.filter((policy) => policyAppliesToOptionalScope(policy.toolNames, tool.toolName))
			.filter((policy) => policyAppliesToOptionalScope(policy.operations, tool.operation))
			.map((policy) => ref("tool-provider-execution-policy", policy.policyId)),
	);
}

export function policyAppliesToProfile(
	policy: ToolProviderExecutionPolicy,
	profileId: string,
): boolean {
	return policyAppliesToOptionalScope(policy.profileIds, profileId);
}

export function policyAppliesToOptionalScope(
	scope: readonly string[] | undefined,
	value: string | undefined,
): boolean {
	return (
		scope === undefined || scope.length === 0 || (value !== undefined && scope.includes(value))
	);
}

export function toolCallFromRequest(request: AgentRequestIssued): ToolCallInput | undefined {
	const value = request.input?.value;
	if (request.input?.inputKind !== "tool-call" || !isRecord(value)) return undefined;
	if (
		value.kind !== "tool-call" ||
		typeof value.toolName !== "string" ||
		value.toolName.length === 0
	) {
		return undefined;
	}
	return value as unknown as ToolCallInput;
}

export function resolveToolProviderPolicyForRoute(
	request: AgentRequestIssued,
	route: ExecutorRoute,
	toolCall: ToolCallInput,
	catalogs: readonly ToolProviderCatalog[],
): ToolProviderPolicyResolution {
	const sourceRefs = Object.freeze([
		ref("agent-request", request.requestId),
		ref("executor-route", route.routeId),
	]);
	const matchingCatalogs = catalogs.filter((catalog) => catalogHasRouteProfile(catalog, route));
	if (matchingCatalogs.length === 0) {
		return policyResolutionWithIssue({
			request,
			route,
			toolCall,
			status: "missing-catalog",
			sourceRefs,
			issue: dataIssue(
				"tool-provider-policy-missing-catalog",
				`No tool provider catalog exposes route profile '${route.profileId}'.`,
				{ subjectId: request.requestId, refs: sourceRefs },
			),
		});
	}
	if (matchingCatalogs.length > 1) {
		return policyResolutionWithIssue({
			request,
			route,
			toolCall,
			status: "ambiguous-catalog",
			sourceRefs,
			issue: dataIssue(
				"tool-provider-policy-ambiguous-catalog",
				`Multiple tool provider catalogs expose route profile '${route.profileId}'.`,
				{
					subjectId: request.requestId,
					refs: [
						...sourceRefs,
						...matchingCatalogs.map((catalog) => ref("tool-provider-catalog", catalog.providerId)),
					],
				},
			),
		});
	}
	const catalog = matchingCatalogs[0];
	if (catalog === undefined) throw new Error("unreachable catalog match");
	const tool = catalog.tools.find(
		(entry) =>
			entry.profileId === route.profileId &&
			entry.executorId === route.executorId &&
			entry.toolName === toolCall.toolName &&
			(entry.operation === undefined ||
				toolCall.operation === undefined ||
				entry.operation === toolCall.operation),
	);
	if (tool === undefined) {
		return policyResolutionWithIssue({
			request,
			route,
			toolCall,
			status: "missing-tool",
			sourceRefs,
			providerId: catalog.providerId,
			issue: dataIssue(
				"tool-provider-policy-missing-tool",
				`Tool provider catalog '${catalog.providerId}' does not expose requested tool '${toolCall.toolName}'.`,
				{
					subjectId: request.requestId,
					refs: [...sourceRefs, ref("tool-provider-catalog", catalog.providerId)],
				},
			),
		});
	}
	const policyRefs = policyRefsForResolution(catalog, route, tool);
	if (policyRefs.length === 0) {
		return policyResolutionWithIssue({
			request,
			route,
			toolCall,
			status: "missing-policy",
			sourceRefs,
			providerId: catalog.providerId,
			issue: dataIssue(
				"tool-provider-policy-missing-policy-ref",
				`Tool '${tool.toolName}' has no D360 policy refs on its entry, profile, or catalog.`,
				{
					subjectId: request.requestId,
					refs: [...sourceRefs, ref("tool-provider-catalog", catalog.providerId)],
				},
			),
		});
	}
	const issues = policyIssuesForRefs(catalog, policyRefs, request, sourceRefs);
	const status = issues.length === 0 ? "resolved" : "invalid-policy";
	return Object.freeze({
		kind: "tool-provider-policy-resolution",
		resolutionId: compoundTupleKey("tool-provider-policy-resolution", [
			request.requestId,
			request.operationId,
			route.routeId,
			"resolved",
		]),
		status,
		requestId: request.requestId,
		operationId: request.operationId,
		routeId: route.routeId,
		providerId: catalog.providerId,
		executorId: route.executorId,
		profileId: route.profileId,
		toolName: toolCall.toolName,
		operation: toolCall.operation,
		policyRefs,
		issues: issues.length === 0 ? undefined : Object.freeze(issues),
		sourceRefs: Object.freeze([...sourceRefs, ref("tool-provider-catalog", catalog.providerId)]),
	} satisfies ToolProviderPolicyResolution);
}

export function catalogHasRouteProfile(
	catalog: ToolProviderCatalog,
	route: ExecutorRoute,
): boolean {
	return catalog.profiles.some(
		(profile) => profile.profileId === route.profileId && profile.executorId === route.executorId,
	);
}

export function policyRefsForResolution(
	catalog: ToolProviderCatalog,
	route: ExecutorRoute,
	tool: ToolProviderCatalogEntry,
): readonly SourceRef[] {
	const profile = catalog.profiles.find(
		(candidate) =>
			candidate.profileId === route.profileId && candidate.executorId === route.executorId,
	);
	return Object.freeze([
		...(tool.policyRefs ?? []),
		...((tool.policyRefs?.length ?? 0) === 0 ? (profile?.policyRefs ?? []) : []),
		...((tool.policyRefs?.length ?? 0) === 0 && (profile?.policyRefs?.length ?? 0) === 0
			? (catalog.policyRefs ?? [])
			: []),
	]);
}

export function policyIssuesForRefs(
	catalog: ToolProviderCatalog,
	policyRefs: readonly SourceRef[],
	request: AgentRequestIssued,
	sourceRefs: readonly SourceRef[],
): readonly DataIssue[] {
	const policiesById = new Map((catalog.policies ?? []).map((policy) => [policy.policyId, policy]));
	const issues: DataIssue[] = [];
	for (const policyRef of policyRefs) {
		if (policyRef.kind !== "tool-provider-execution-policy") {
			issues.push(
				dataIssue(
					"tool-provider-policy-invalid-ref-kind",
					"Tool provider policy refs must point at ToolProviderExecutionPolicy facts.",
					{ subjectId: request.requestId, refs: [...sourceRefs, policyRef] },
				),
			);
			continue;
		}
		const policy = policiesById.get(policyRef.id);
		if (policy === undefined) {
			issues.push(
				dataIssue(
					"tool-provider-policy-ref-missing-material",
					`Tool provider policy ref '${policyRef.id}' has no policy material in catalog '${catalog.providerId}'.`,
					{ subjectId: request.requestId, refs: [...sourceRefs, policyRef] },
				),
			);
			continue;
		}
		issues.push(...validateToolProviderExecutionPolicy(policy));
		issues.push(...validateToolProviderPolicyProviderScope(policy, catalog.providerId));
	}
	return Object.freeze(issues);
}

export function policyResolutionWithIssue(opts: {
	readonly request: AgentRequestIssued;
	readonly route: ExecutorRoute;
	readonly toolCall: ToolCallInput;
	readonly status: ToolProviderPolicyResolutionStatus;
	readonly sourceRefs: readonly SourceRef[];
	readonly issue: DataIssue;
	readonly providerId?: string;
}): ToolProviderPolicyResolution {
	return Object.freeze({
		kind: "tool-provider-policy-resolution",
		resolutionId: compoundTupleKey("tool-provider-policy-resolution", [
			opts.request.requestId,
			opts.request.operationId,
			opts.route.routeId,
			opts.status,
		]),
		status: opts.status,
		requestId: opts.request.requestId,
		operationId: opts.request.operationId,
		routeId: opts.route.routeId,
		providerId: opts.providerId,
		executorId: opts.route.executorId,
		profileId: opts.route.profileId,
		toolName: opts.toolCall.toolName,
		operation: opts.toolCall.operation,
		issues: Object.freeze([opts.issue]),
		sourceRefs: opts.sourceRefs,
	} satisfies ToolProviderPolicyResolution);
}

export function stableToolProviderPolicyResolutionKey(
	resolution: ToolProviderPolicyResolution,
): string {
	return JSON.stringify({
		id: resolution.resolutionId,
		status: resolution.status,
		policyRefs:
			resolution.policyRefs?.map((policyRef) =>
				canonicalTupleKey([policyRef.kind, policyRef.id]),
			) ?? [],
		issues: resolution.issues?.map((issue) => issue.code) ?? [],
	});
}

export function defaultLocalBuiltinToolProviderExecutionPolicy(opts: {
	readonly providerId: string;
	readonly profileId: string;
	readonly tools: readonly Omit<
		ToolProviderCatalogEntry,
		"kind" | "providerId" | "inputKind" | "profileId" | "executorId"
	>[];
	readonly overrides?: Partial<
		Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">
	>;
}): ToolProviderExecutionPolicy {
	const toolNames = Object.freeze(Array.from(new Set(opts.tools.map((tool) => tool.toolName))));
	const operations = Object.freeze(
		Array.from(new Set(opts.tools.map((tool) => tool.operation).filter((op) => op !== undefined))),
	);
	const hasUrlFetch = toolNames.includes("url.fetch");
	const filesystemToolNames = toolNames.filter(
		(toolName) =>
			toolName.startsWith("file.") || toolName.startsWith("document/") || toolName === "bash.run",
	);
	const approvalToolNames = toolNames.filter(
		(toolName) => toolName === "file.edit/apply-patch" || toolName === "bash.run",
	);
	const approvalOperations = operations.filter(
		(operation) => operation === "edit" || operation === "run",
	);
	const policy = {
		kind: "tool-provider-execution-policy",
		policyId: `${opts.providerId}:policy:default`,
		providerId: opts.providerId,
		profileIds: Object.freeze([opts.profileId]),
		toolNames,
		operations,
		sizeCapacity: Object.freeze({
			limits: Object.freeze([
				Object.freeze({
					unit: "chars",
					softLimit: 16_384,
					hardLimit: 65_536,
					perRequest: true,
					measurementSource: "adapter-estimated",
				} satisfies ToolProviderSizeLimit),
				Object.freeze({
					unit: "bytes",
					softLimit: 1_048_576,
					hardLimit: 8_388_608,
					perArtifact: true,
					measurementSource: "adapter-measured",
				} satisfies ToolProviderSizeLimit),
				Object.freeze({
					unit: "lines",
					softLimit: 2_000,
					hardLimit: 10_000,
					perStream: true,
					measurementSource: "adapter-measured",
				} satisfies ToolProviderSizeLimit),
			]),
		} satisfies ToolProviderSizeCapacityPolicy),
		timeout: Object.freeze({
			timeoutMs: 30_000,
			idleTimeoutMs: 5_000,
		} satisfies ToolProviderTimeoutPolicy),
		redaction: Object.freeze({
			mode: "summary",
			sensitivity: Object.freeze(["private-material", "auth-material", "personal-data"]),
			summaryMaxChars: 512,
		} satisfies ToolProviderRedactionPolicy),
		...(filesystemToolNames.length > 0
			? {
					filesystem: Object.freeze({
						cwd: ".",
						allowRead: true,
						allowWrite: false,
						followSymlinks: false,
						sourceRefs: Object.freeze(filesystemToolNames.map((toolName) => ref("tool", toolName))),
						pathRules: Object.freeze([
							Object.freeze({
								effect: "allow",
								path: ".",
								operation: "read",
								reason: "Default local builtin catalog is workspace-relative data material.",
							} satisfies ToolProviderPathRule),
							Object.freeze({
								effect: "deny",
								glob: "**/.env*",
								reason: "D360 policies keep private material outside catalog DATA.",
							} satisfies ToolProviderPathRule),
						]),
					} satisfies ToolProviderFilesystemPolicy),
				}
			: {}),
		...(hasUrlFetch
			? {
					network: Object.freeze({
						mode: "custom",
						protocols: Object.freeze(["https:"]),
						allowedHosts: Object.freeze(["*"]),
						sourceRefs: Object.freeze([ref("tool", "url.fetch")]),
					} satisfies ToolProviderNetworkPolicy),
				}
			: {}),
		approval: Object.freeze({
			mode: approvalToolNames.length > 0 ? "require" : "auto",
			...(approvalToolNames.length > 0
				? { requiredForToolNames: Object.freeze(approvalToolNames) }
				: {}),
			...(approvalOperations.length > 0
				? { requiredForOperations: Object.freeze(approvalOperations) }
				: {}),
		} satisfies ToolProviderApprovalPolicy),
		artifacts: Object.freeze({
			defaultDataMode: "summary",
			artifactKinds: Object.freeze([
				"text",
				"markdown",
				"file",
				"stdout",
				"stderr",
				"tool-output",
				"provider-raw",
			]),
			inlineLimits: Object.freeze([
				Object.freeze({
					unit: "chars",
					hardLimit: 4_096,
					perArtifact: true,
					measurementSource: "adapter-estimated",
				} satisfies ToolProviderSizeLimit),
			]),
			requireDigest: false,
		} satisfies ToolProviderArtifactPolicy),
		sourceRefs: Object.freeze([ref("decision", "D360"), ref("tool-provider", opts.providerId)]),
		metadata: Object.freeze({
			description: "Default data-only policy material for local builtin tools.",
		}),
		...unlockedToolProviderPolicyOverrides(opts.overrides),
	} satisfies ToolProviderExecutionPolicy;
	return Object.freeze(policy);
}
