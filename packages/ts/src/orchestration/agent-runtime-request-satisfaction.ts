import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import {
	dataIssue,
	forEachDepBatch,
	ref,
	sanitizeAdapterInputIssue,
	sanitizeAdapterInputSourceRefs,
} from "./agent-runtime-common.js";
import type {
	AgentRequestSatisfactionBundle,
	AgentRuntimeAuditRecord,
	ContextContribution,
	PromptBundle,
} from "./agent-runtime-types-agent.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	AgentRequestStatus,
	AgentRequestStatusChanged,
	ExecutorOutcome,
	ExecutorProfile,
	ExecutorRoute,
	SourceRef,
} from "./agent-runtime-types-core.js";

export interface RequestSatisfactionState {
	requests: Map<string, AgentRequestIssued>;
	profiles: Map<string, ExecutorProfile>;
	routes: Map<string, ExecutorRoute>;
	outcomes: Map<string, ExecutorOutcome>;
	contexts: Map<string, ContextContribution>;
	prompts: Map<string, PromptBundle>;
	compatibleRoutesByRouteId: Map<string, ExecutorRoute>;
	terminalRequests: Set<string>;
	acceptedTerminalFactIds: Set<string>;
	issueKeys: Set<string>;
	statusKeys: Set<string>;
	issueSeq: number;
	auditSeq: number;
}

export function requestSatisfactionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly requestFacts: Node<AgentRequestFact>;
		readonly executorProfiles?: readonly Node<ExecutorProfile>[];
		readonly executorRoutes?: readonly Node<ExecutorRoute>[];
		readonly executorOutcomes?: readonly Node<ExecutorOutcome>[];
		readonly contextContributions?: readonly Node<ContextContribution>[];
		readonly promptBundles?: readonly Node<PromptBundle>[];
	},
): AgentRequestSatisfactionBundle {
	const name = opts.name ?? "requestSatisfaction";
	const profileDeps = opts.executorProfiles ?? [];
	const routeDeps = opts.executorRoutes ?? [];
	const outcomeDeps = opts.executorOutcomes ?? [];
	const contextDeps = opts.contextContributions ?? [];
	const promptDeps = opts.promptBundles ?? [];
	const deps = [
		opts.requestFacts,
		...profileDeps,
		...routeDeps,
		...outcomeDeps,
		...contextDeps,
		...promptDeps,
	];
	const profileStart = 1;
	const routeStart = profileStart + profileDeps.length;
	const outcomeStart = routeStart + routeDeps.length;
	const contextStart = outcomeStart + outcomeDeps.length;
	const promptStart = contextStart + contextDeps.length;
	const runtime = graph.node<AgentRequestSatisfactionFact>(
		deps,
		(ctx) => {
			const state = ctx.state.get<RequestSatisfactionState>() ?? {
				requests: new Map<string, AgentRequestIssued>(),
				profiles: new Map<string, ExecutorProfile>(),
				routes: new Map<string, ExecutorRoute>(),
				outcomes: new Map<string, ExecutorOutcome>(),
				contexts: new Map<string, ContextContribution>(),
				prompts: new Map<string, PromptBundle>(),
				compatibleRoutesByRouteId: new Map<string, ExecutorRoute>(),
				terminalRequests: new Set<string>(),
				acceptedTerminalFactIds: new Set<string>(),
				issueKeys: new Set<string>(),
				statusKeys: new Set<string>(),
				issueSeq: 0,
				auditSeq: 0,
			};
			for (const fact of depBatch(ctx, 0) ?? []) {
				if ((fact as AgentRequestFact).kind === "issued") {
					const request = fact as AgentRequestIssued;
					state.requests.set(request.requestId, request);
					emitStatus(ctx, state, request, initialRequestStatus(request), [
						ref("agent-request", request.requestId),
					]);
				}
			}
			forEachDepBatch(ctx, profileStart, profileDeps.length, (raw) => {
				const profile = raw as ExecutorProfile;
				state.profiles.set(profile.profileId, profile);
			});
			forEachDepBatch(ctx, routeStart, routeDeps.length, (raw) => {
				const route = raw as ExecutorRoute;
				state.routes.set(route.routeId, route);
			});
			forEachDepBatch(ctx, outcomeStart, outcomeDeps.length, (raw) => {
				const outcome = raw as ExecutorOutcome;
				state.outcomes.set(outcome.outcomeId, outcome);
			});
			forEachDepBatch(ctx, contextStart, contextDeps.length, (raw) => {
				const contribution = raw as ContextContribution;
				state.contexts.set(contribution.contributionId, contribution);
			});
			forEachDepBatch(ctx, promptStart, promptDeps.length, (raw) => {
				const prompt = raw as PromptBundle;
				state.prompts.set(prompt.promptId, prompt);
			});
			evaluateRequestSatisfaction(ctx, state);
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "requestSatisfactionProjector" },
	);
	const status = graph.node<AgentRequestStatusChanged>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as AgentRequestSatisfactionFact;
				if (typed.kind === "status") ctx.down([["DATA", typed.status]]);
			}
		},
		{ name: `${name}/status`, factory: "requestSatisfactionStatus" },
	);
	const issues = graph.node<DataIssue>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as AgentRequestSatisfactionFact;
				if (typed.kind === "issue") ctx.down([["DATA", typed.issue]]);
			}
		},
		{ name: `${name}/issues`, factory: "requestSatisfactionIssues" },
	);
	const audit = graph.node<AgentRuntimeAuditRecord>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as AgentRequestSatisfactionFact;
				if (typed.kind === "audit") ctx.down([["DATA", typed.audit]]);
			}
		},
		{ name: `${name}/audit`, factory: "requestSatisfactionAudit" },
	);
	return { status, issues, audit };
}

export type AgentRequestSatisfactionFact =
	| { readonly kind: "status"; readonly status: AgentRequestStatusChanged }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export function initialRequestStatus(request: AgentRequestIssued): AgentRequestStatus {
	if (request.requestKind === "context") return "awaiting-context";
	if (request.requestKind === "prompt") return "awaiting-prompt";
	return "awaiting-route";
}

export function evaluateRequestSatisfaction(ctx: Ctx, state: RequestSatisfactionState): void {
	for (const route of state.routes.values()) handleRoute(ctx, state, route);
	for (const contribution of state.contexts.values())
		handleContextContribution(ctx, state, contribution);
	for (const prompt of state.prompts.values()) handlePromptBundle(ctx, state, prompt);
	for (const outcome of state.outcomes.values()) handleExecutorOutcome(ctx, state, outcome);
}

export function handleRoute(ctx: Ctx, state: RequestSatisfactionState, route: ExecutorRoute): void {
	const request = state.requests.get(route.requestId);
	if (request === undefined) {
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (state.compatibleRoutesByRouteId.get(route.routeId)?.requestId !== request.requestId) {
			emitIssueOnce(
				ctx,
				state,
				`late-route:${route.routeId}`,
				"late-route-after-terminal",
				`ExecutorRoute '${route.routeId}' arrived after request '${request.requestId}' was already terminal`,
				request.requestId,
				[ref("executor-route", route.routeId), ref("agent-request", request.requestId)],
			);
		}
		return;
	}
	if (request.operationId !== route.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-route:${route.routeId}`,
			"stale-route-operation",
			`ExecutorRoute '${route.routeId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("executor-route", route.routeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	const profile = state.profiles.get(route.profileId);
	if (profile === undefined) {
		return;
	}
	const compatibilityIssue = routeCompatibilityIssue(request, route, profile);
	if (compatibilityIssue !== undefined) {
		emitIssueOnce(
			ctx,
			state,
			`route-incompatible:${route.routeId}:${compatibilityIssue}`,
			compatibilityIssue,
			`ExecutorRoute '${route.routeId}' is incompatible with request '${request.requestId}'`,
			request.requestId,
			[
				ref("executor-route", route.routeId),
				ref("executor-profile", profile.profileId),
				ref("agent-request", request.requestId),
			],
		);
		return;
	}
	state.compatibleRoutesByRouteId.set(route.routeId, route);
	emitStatusOnce(
		ctx,
		state,
		`route:${route.routeId}:awaiting-provider`,
		request,
		"awaiting-provider",
		[
			ref("executor-route", route.routeId),
			ref("executor-profile", profile.profileId),
			ref("agent-request", request.requestId),
		],
	);
}

export function handleExecutorOutcome(
	ctx: Ctx,
	state: RequestSatisfactionState,
	outcome: ExecutorOutcome,
): void {
	const request = state.requests.get(outcome.requestId);
	if (request === undefined) {
		return;
	}
	if (request.operationId !== outcome.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-outcome:${outcome.outcomeId}`,
			"stale-outcome-operation",
			`ExecutorOutcome '${outcome.outcomeId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("executor-outcome", outcome.outcomeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	const route = state.compatibleRoutesByRouteId.get(outcome.routeId);
	if (route === undefined || route.requestId !== request.requestId) {
		emitIssueOnce(
			ctx,
			state,
			`missing-route:${outcome.outcomeId}`,
			"missing-compatible-route",
			`ExecutorOutcome '${outcome.outcomeId}' has no compatible route for request '${request.requestId}'`,
			request.requestId,
			[ref("executor-outcome", outcome.outcomeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	const outcomeIssue = outcomeCompatibilityIssue(request, route, outcome);
	if (outcomeIssue !== undefined) {
		emitIssueOnce(
			ctx,
			state,
			`outcome-incompatible:${outcome.outcomeId}:${outcomeIssue}`,
			outcomeIssue,
			`ExecutorOutcome '${outcome.outcomeId}' is incompatible with route '${route.routeId}' for request '${request.requestId}'`,
			request.requestId,
			[
				ref("executor-outcome", outcome.outcomeId),
				ref("executor-route", route.routeId),
				ref("agent-request", request.requestId),
			],
		);
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (state.acceptedTerminalFactIds.has(`outcome:${outcome.outcomeId}`)) return;
		emitIssueOnce(
			ctx,
			state,
			`duplicate-outcome:${outcome.outcomeId}`,
			"duplicate-terminal-outcome",
			`ExecutorOutcome '${outcome.outcomeId}' arrived after request '${request.requestId}' was already terminal`,
			request.requestId,
			[ref("executor-outcome", outcome.outcomeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	state.terminalRequests.add(request.requestId);
	state.acceptedTerminalFactIds.add(`outcome:${outcome.outcomeId}`);
	const status = outcomeStatus(outcome);
	emitStatus(ctx, state, request, status, [
		ref("executor-outcome", outcome.outcomeId),
		ref("executor-route", route.routeId),
		ref("agent-request", request.requestId),
	]);
}

export function handleContextContribution(
	ctx: Ctx,
	state: RequestSatisfactionState,
	contribution: ContextContribution,
): void {
	const request = state.requests.get(contribution.requestId);
	if (request === undefined) return;
	if (request.operationId !== contribution.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-context:${contribution.contributionId}`,
			"stale-context-operation",
			`ContextContribution '${contribution.contributionId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("context-contribution", contribution.contributionId)],
		);
		return;
	}
	if (request.requestKind !== "context") {
		emitIssueOnce(
			ctx,
			state,
			`wrong-context-kind:${contribution.contributionId}`,
			"wrong-kind-context-satisfaction",
			`ContextContribution '${contribution.contributionId}' cannot satisfy ${request.requestKind} request '${request.requestId}'`,
			request.requestId,
			[ref("context-contribution", contribution.contributionId)],
		);
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (
			state.acceptedTerminalFactIds.has(`context:${contribution.contributionId}`) ||
			state.statusKeys.has(`context:${contribution.contributionId}:awaiting-context`)
		) {
			return;
		}
		emitIssueOnce(
			ctx,
			state,
			`duplicate-context:${contribution.contributionId}`,
			"duplicate-terminal-context",
			`ContextContribution '${contribution.contributionId}' arrived after request '${request.requestId}' was already terminal`,
			request.requestId,
			[
				ref("context-contribution", contribution.contributionId),
				ref("agent-request", request.requestId),
			],
		);
		return;
	}
	if (contribution.status === "pending")
		emitStatusOnce(
			ctx,
			state,
			`context:${contribution.contributionId}:awaiting-context`,
			request,
			"awaiting-context",
			[ref("context-contribution", contribution.contributionId)],
		);
	else {
		state.terminalRequests.add(request.requestId);
		state.acceptedTerminalFactIds.add(`context:${contribution.contributionId}`);
		emitStatus(
			ctx,
			state,
			request,
			contribution.status === "ready" ? "completed" : "failed",
			[ref("context-contribution", contribution.contributionId)],
			contribution.issues,
		);
	}
}

export function handlePromptBundle(
	ctx: Ctx,
	state: RequestSatisfactionState,
	prompt: PromptBundle,
): void {
	const request = state.requests.get(prompt.requestId);
	if (request === undefined) return;
	if (request.operationId !== prompt.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-prompt:${prompt.promptId}`,
			"stale-prompt-operation",
			`PromptBundle '${prompt.promptId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("prompt-bundle", prompt.promptId)],
		);
		return;
	}
	if (request.requestKind !== "prompt") {
		emitIssueOnce(
			ctx,
			state,
			`wrong-prompt-kind:${prompt.promptId}`,
			"wrong-kind-prompt-satisfaction",
			`PromptBundle '${prompt.promptId}' cannot satisfy ${request.requestKind} request '${request.requestId}'`,
			request.requestId,
			[ref("prompt-bundle", prompt.promptId)],
		);
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (
			state.acceptedTerminalFactIds.has(`prompt:${prompt.promptId}`) ||
			state.statusKeys.has(`prompt:${prompt.promptId}:awaiting-prompt`)
		) {
			return;
		}
		emitIssueOnce(
			ctx,
			state,
			`duplicate-prompt:${prompt.promptId}`,
			"duplicate-terminal-prompt",
			`PromptBundle '${prompt.promptId}' arrived after request '${request.requestId}' was already terminal`,
			request.requestId,
			[ref("prompt-bundle", prompt.promptId), ref("agent-request", request.requestId)],
		);
		return;
	}
	if (prompt.status === "ready") {
		state.terminalRequests.add(request.requestId);
		state.acceptedTerminalFactIds.add(`prompt:${prompt.promptId}`);
		emitStatus(ctx, state, request, "completed", [ref("prompt-bundle", prompt.promptId)]);
	} else if (prompt.status === "issue") {
		state.terminalRequests.add(request.requestId);
		state.acceptedTerminalFactIds.add(`prompt:${prompt.promptId}`);
		emitStatus(
			ctx,
			state,
			request,
			"failed",
			[ref("prompt-bundle", prompt.promptId)],
			prompt.issues,
		);
	} else {
		emitStatusOnce(
			ctx,
			state,
			`prompt:${prompt.promptId}:awaiting-prompt`,
			request,
			"awaiting-prompt",
			[ref("prompt-bundle", prompt.promptId)],
			prompt.issues,
		);
	}
}

export function routeCompatibilityIssue(
	request: AgentRequestIssued,
	route: ExecutorRoute,
	profile: ExecutorProfile,
): string | undefined {
	if (request.requestKind !== "executor") return "route-for-non-executor-request";
	if (route.executorId !== profile.executorId) return "route-profile-executor-mismatch";
	if (
		request.input?.inputId !== undefined &&
		route.inputId !== undefined &&
		request.input.inputId !== route.inputId
	) {
		return "route-input-mismatch";
	}
	if (
		request.input?.inputKind !== undefined &&
		route.inputKind !== undefined &&
		request.input.inputKind !== route.inputKind
	) {
		return "route-input-kind-mismatch";
	}
	const inputKind = request.input?.inputKind ?? route.inputKind;
	if (inputKind !== undefined && !profileKindAcceptsInput(profile.kind, inputKind))
		return "profile-kind-input-incompatible";
	if (
		inputKind !== undefined &&
		profile.acceptedInputKinds !== undefined &&
		!profile.acceptedInputKinds.includes(inputKind)
	) {
		return "profile-rejects-input-kind";
	}
	if (
		request.input?.schemaRef !== undefined &&
		profile.acceptedSchemaRefs !== undefined &&
		!profile.acceptedSchemaRefs.includes(request.input.schemaRef)
	) {
		return "profile-rejects-schema";
	}
	return undefined;
}

export function outcomeCompatibilityIssue(
	request: AgentRequestIssued,
	route: ExecutorRoute,
	outcome: ExecutorOutcome,
): string | undefined {
	if (outcome.executorId !== route.executorId) return "outcome-route-executor-mismatch";
	if (outcome.profileId !== route.profileId) return "outcome-route-profile-mismatch";
	if (
		route.inputId !== undefined &&
		(outcome.inputId === undefined || outcome.inputId !== route.inputId)
	) {
		return "outcome-route-input-mismatch";
	}
	if (
		request.input?.inputId !== undefined &&
		outcome.inputId !== undefined &&
		outcome.inputId !== request.input.inputId
	) {
		return "outcome-request-input-mismatch";
	}
	if (
		route.inputKind !== undefined &&
		(outcome.inputKind === undefined || outcome.inputKind !== route.inputKind)
	) {
		return "outcome-route-input-kind-mismatch";
	}
	if (
		request.input?.inputKind !== undefined &&
		outcome.inputKind !== undefined &&
		outcome.inputKind !== request.input.inputKind
	) {
		return "outcome-request-input-kind-mismatch";
	}
	return undefined;
}

export function profileKindAcceptsInput(kind: ExecutorProfile["kind"], inputKind: string): boolean {
	if (kind === "llm") return inputKind === "llm-call";
	if (kind === "tool") return inputKind === "tool-call";
	if (kind === "human") return inputKind === "human-task";
	return inputKind === "agent-task";
}

export function outcomeStatus(outcome: ExecutorOutcome): AgentRequestStatus {
	if (outcome.kind === "result") return "completed";
	if (outcome.kind === "failure") return "failed";
	if (outcome.kind === "timeout") return "timeout";
	if (outcome.kind === "canceled") return "canceled";
	return "blocked";
}

export function emitStatus(
	ctx: Ctx,
	state: RequestSatisfactionState,
	request: AgentRequestIssued,
	status: AgentRequestStatus,
	sourceRefs?: readonly SourceRef[],
	issues?: readonly DataIssue[],
): void {
	const cleanSourceRefs =
		sourceRefs === undefined ? undefined : sanitizeAdapterInputSourceRefs(sourceRefs);
	const cleanIssues =
		issues === undefined
			? undefined
			: Object.freeze(issues.map((issue) => sanitizeAdapterInputIssue(issue)));
	const fact: AgentRequestStatusChanged = {
		kind: "status",
		requestId: request.requestId,
		operationId: request.operationId,
		effectRunId: request.effectRunId,
		status,
		sourceRefs: cleanSourceRefs,
		issues: cleanIssues,
	};
	state.auditSeq += 1;
	ctx.down([
		["DATA", { kind: "status", status: fact } satisfies AgentRequestSatisfactionFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${request.requestId}:status:${state.auditSeq}`,
					kind: "agent-request-status",
					subjectId: request.requestId,
					sourceRefs: cleanSourceRefs,
					metadata: { status },
				},
			} satisfies AgentRequestSatisfactionFact,
		],
	]);
}

export function emitStatusOnce(
	ctx: Ctx,
	state: RequestSatisfactionState,
	key: string,
	request: AgentRequestIssued,
	status: AgentRequestStatus,
	sourceRefs?: readonly SourceRef[],
	issues?: readonly DataIssue[],
): void {
	if (state.statusKeys.has(key)) return;
	state.statusKeys.add(key);
	emitStatus(ctx, state, request, status, sourceRefs, issues);
}

export function emitIssue(
	ctx: Ctx,
	state: RequestSatisfactionState,
	code: string,
	message: string,
	subjectId?: string,
	refs?: readonly SourceRef[],
): void {
	state.issueSeq += 1;
	const issue = dataIssue(code, message, { subjectId, refs });
	state.auditSeq += 1;
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies AgentRequestSatisfactionFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${subjectId ?? "request"}:issue:${state.auditSeq}`,
					kind: "agent-request-issue",
					subjectId,
					issueCode: code,
					message,
					sourceRefs: refs,
				},
			} satisfies AgentRequestSatisfactionFact,
		],
	]);
}

export function emitIssueOnce(
	ctx: Ctx,
	state: RequestSatisfactionState,
	key: string,
	code: string,
	message: string,
	subjectId?: string,
	refs?: readonly SourceRef[],
): void {
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	emitIssue(ctx, state, code, message, subjectId, refs);
}
