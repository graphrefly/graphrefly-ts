/**
 * Focused execution-environment targeting contract and local-host gate (D603).
 *
 * ExecutorProfile and ExecutorRoute remain canonical. This surface only gives
 * those facts a strict environment pin and validates an already D419-admitted
 * run before a concrete local-host binding may observe it.
 */

import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import {
	type AgentRuntimeAuditRecord,
	type ExecutorProfile,
	type ExecutorRoute,
	requestToolProviderAdapterRun,
	type SourceRef,
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunReason,
	type ToolProviderAdapterRunRequested,
} from "../orchestration/index.js";

export type ExecutionEnvironmentLocality = "local" | "managed-cloud" | "customer-hosted";
export type ExecutionEnvironmentBindingKind =
	| "local-host-process"
	| "local-container"
	| "remote-session";
export type ExecutionEnvironmentReadinessState = "ready" | "stale" | "unavailable";

export interface ExecutionEnvironmentCoordinate {
	readonly environmentId: string;
	readonly revision: string;
}

export interface ExecutionEnvironmentReadiness {
	readonly state: ExecutionEnvironmentReadinessState;
	readonly observedAtMs: number;
	readonly expiresAtMs: number;
	readonly attestationRefs?: readonly SourceRef[];
}

export interface ExecutionEnvironmentTarget extends ExecutionEnvironmentCoordinate {
	readonly kind: "execution-environment-target";
	readonly locality: ExecutionEnvironmentLocality;
	readonly bindingKind: ExecutionEnvironmentBindingKind;
	readonly capabilities?: readonly string[];
	readonly limits?: Readonly<Record<string, number>>;
	readonly policyRefs?: readonly SourceRef[];
	readonly movementPolicyRefs?: readonly SourceRef[];
	readonly readiness: ExecutionEnvironmentReadiness;
}

export interface EnvironmentPinnedExecutorProfile extends ExecutorProfile {
	readonly executionEnvironment: ExecutionEnvironmentTarget;
	readonly requiredEnvironmentCapabilities?: readonly string[];
}

export interface EnvironmentPinnedExecutorRoute extends ExecutorRoute {
	readonly executionEnvironment: ExecutionEnvironmentCoordinate;
}

export interface ExecutionEnvironmentPinnedRunMetadata {
	readonly executionEnvironmentId: string;
	readonly executionEnvironmentRevision: string;
	readonly executionEnvironmentLocality: ExecutionEnvironmentLocality;
	readonly executionEnvironmentBindingKind: ExecutionEnvironmentBindingKind;
	readonly executionSessionEpoch: string;
}

export type LocalHostExecutionGateState = "admitted" | "waiting" | "blocked";

export interface LocalHostExecutionGateStatus {
	readonly kind: "local-host-execution-gate-status";
	readonly runId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId?: string;
	readonly profileId?: string;
	readonly environmentId?: string;
	readonly environmentRevision?: string;
	readonly state: LocalHostExecutionGateState;
	readonly code: string;
}

export interface LocalHostExecutionGateOptions {
	readonly name?: string;
	readonly inputs: Node<ToolProviderAdapterInput>;
	readonly profiles: readonly Node<EnvironmentPinnedExecutorProfile>[];
	readonly routes: readonly Node<EnvironmentPinnedExecutorRoute>[];
	/** Only connect `approvedRequests` from toolProviderRunAdmissionProjector here. */
	readonly admittedRunRequests: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly now?: () => number;
}

export interface LocalHostExecutionGateBundle {
	readonly admittedRunRequests: Node<ToolProviderAdapterRunRequested>;
	readonly status: Node<LocalHostExecutionGateStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	dispose(): void;
}

type GateFact =
	| { readonly kind: "request"; readonly request: ToolProviderAdapterRunRequested }
	| { readonly kind: "status"; readonly status: LocalHostExecutionGateStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

interface GateState {
	readonly inputs: Map<string, ToolProviderAdapterInput>;
	readonly profiles: Map<string, EnvironmentPinnedExecutorProfile>;
	readonly routes: Map<string, EnvironmentPinnedExecutorRoute>;
	readonly requests: Map<string, ToolProviderAdapterRunRequested>;
	readonly fingerprints: Map<string, string>;
	readonly emitted: Map<string, string>;
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const MAX_REFS = 32;
const MAX_CAPABILITIES = 32;
const MAX_LIMITS = 32;
const MAX_PLAIN_ENTRIES = 256;
const FORBIDDEN =
	/(?:secret|credential|password|token|sql|statement|client|pool|handle|command|argv|environmentVariables|env)$/i;

export function executionEnvironmentTarget(
	value: ExecutionEnvironmentTarget,
): ExecutionEnvironmentTarget {
	assertPlainData(value, "execution environment target");
	if (value.kind !== "execution-environment-target") throw new TypeError("Invalid target kind.");
	assertCoordinate(value, "execution environment target");
	if (!["local", "managed-cloud", "customer-hosted"].includes(value.locality))
		throw new TypeError("Invalid execution environment locality.");
	if (!["local-host-process", "local-container", "remote-session"].includes(value.bindingKind))
		throw new TypeError("Invalid execution environment binding kind.");
	if (value.locality === "local" && value.bindingKind === "remote-session")
		throw new TypeError("A local target cannot use a remote-session binding.");
	if (value.locality !== "local" && value.bindingKind !== "remote-session")
		throw new TypeError("A remote target must use a remote-session binding.");
	const readiness = snapshotReadiness(value.readiness);
	const capabilities = snapshotStrings(value.capabilities, MAX_CAPABILITIES, "capabilities");
	const limits = snapshotLimits(value.limits);
	return Object.freeze({
		kind: "execution-environment-target",
		environmentId: value.environmentId,
		revision: value.revision,
		locality: value.locality,
		bindingKind: value.bindingKind,
		...(capabilities === undefined ? {} : { capabilities }),
		...(limits === undefined ? {} : { limits }),
		...(value.policyRefs === undefined ? {} : { policyRefs: snapshotRefs(value.policyRefs) }),
		...(value.movementPolicyRefs === undefined
			? {}
			: { movementPolicyRefs: snapshotRefs(value.movementPolicyRefs) }),
		readiness,
	});
}

export function environmentPinnedExecutorProfile(
	profile: EnvironmentPinnedExecutorProfile,
): EnvironmentPinnedExecutorProfile {
	assertPlainData(profile, "environment-pinned executor profile");
	if (![profile.profileId, profile.executorId].every((value) => SAFE.test(value)))
		throw new TypeError("Invalid executor profile coordinate.");
	if (!["llm", "tool", "human", "agent"].includes(profile.kind))
		throw new TypeError("Invalid executor profile kind.");
	return Object.freeze({
		profileId: profile.profileId,
		executorId: profile.executorId,
		kind: profile.kind,
		acceptedInputKinds: snapshotStrings(profile.acceptedInputKinds, 32, "acceptedInputKinds"),
		acceptedSchemaRefs: snapshotStrings(profile.acceptedSchemaRefs, 32, "acceptedSchemaRefs"),
		acceptedResultKinds: snapshotStrings(profile.acceptedResultKinds, 32, "acceptedResultKinds"),
		limits: snapshotLimits(profile.limits),
		policyRefs: profile.policyRefs === undefined ? undefined : snapshotRefs(profile.policyRefs),
		requiredEnvironmentCapabilities: snapshotStrings(
			profile.requiredEnvironmentCapabilities,
			MAX_CAPABILITIES,
			"requiredEnvironmentCapabilities",
		),
		executionEnvironment: executionEnvironmentTarget(profile.executionEnvironment),
	});
}

export function environmentPinnedExecutorRoute(
	route: EnvironmentPinnedExecutorRoute,
): EnvironmentPinnedExecutorRoute {
	assertPlainData(route, "environment-pinned executor route");
	if (route.kind !== "executor-route") throw new TypeError("Invalid executor route kind.");
	for (const value of [
		route.routeId,
		route.requestId,
		route.operationId,
		route.executorId,
		route.profileId,
	])
		if (typeof value !== "string" || !SAFE.test(value))
			throw new TypeError("Invalid executor route coordinate.");
	if (!boundedIdentity(route.inputId) || !SAFE.test(route.inputKind ?? ""))
		throw new TypeError("Invalid executor route input coordinate.");
	assertCoordinate(route.executionEnvironment, "executor route environment");
	return Object.freeze({
		kind: "executor-route",
		routeId: route.routeId,
		requestId: route.requestId,
		operationId: route.operationId,
		inputId: route.inputId,
		inputKind: route.inputKind,
		executorId: route.executorId,
		profileId: route.profileId,
		reason:
			typeof route.reason === "string" && route.reason.length <= 512 ? route.reason : undefined,
		evidenceRefs: route.evidenceRefs === undefined ? undefined : snapshotRefs(route.evidenceRefs),
		executionEnvironment: Object.freeze({ ...route.executionEnvironment }),
	});
}

export function requestEnvironmentPinnedToolProviderRun(
	input: ToolProviderAdapterInput,
	profile: EnvironmentPinnedExecutorProfile,
	route: EnvironmentPinnedExecutorRoute,
	opts: {
		readonly runId?: string;
		readonly attempt?: number;
		readonly reason?: ToolProviderAdapterRunReason;
		readonly retryOfOutcomeId?: string;
		readonly policyRefs?: readonly SourceRef[];
		readonly sourceRefs?: readonly SourceRef[];
		readonly requestedAtMs?: number;
		readonly sessionEpoch?: string;
	} = {},
): ToolProviderAdapterRunRequested {
	const safeProfile = environmentPinnedExecutorProfile(profile);
	const safeRoute = environmentPinnedExecutorRoute(route);
	if (!inputMatchesProfileRoute(input, safeProfile, safeRoute))
		throw new TypeError(
			"Adapter input does not exactly match the environment-pinned profile and route.",
		);
	const metadata: ExecutionEnvironmentPinnedRunMetadata = Object.freeze({
		executionEnvironmentId: safeProfile.executionEnvironment.environmentId,
		executionEnvironmentRevision: safeProfile.executionEnvironment.revision,
		executionEnvironmentLocality: safeProfile.executionEnvironment.locality,
		executionEnvironmentBindingKind: safeProfile.executionEnvironment.bindingKind,
		executionSessionEpoch: opts.sessionEpoch ?? "session:local-host-process",
	});
	return requestToolProviderAdapterRun(input, { ...opts, metadata: { ...metadata } });
}

export function localHostExecutionGate(
	graph: Graph,
	opts: LocalHostExecutionGateOptions,
): LocalHostExecutionGateBundle {
	if (
		opts.profiles.length === 0 ||
		opts.routes.length === 0 ||
		opts.admittedRunRequests.length === 0
	)
		throw new TypeError("Local host gate requires profile, route, and admitted-run graph inputs.");
	const name = opts.name ?? "localHostExecutionGate";
	const topology = graph.topologyGroup({ name });
	const deps: readonly Node<unknown>[] = [
		opts.inputs,
		...opts.profiles,
		...opts.routes,
		...opts.admittedRunRequests,
	];
	const runtime = topology.node<GateFact>(deps, (ctx) => reduceGate(ctx, opts), {
		name: `${name}/runtime`,
		factory: "localHostExecutionGateRuntime",
		partial: true,
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	let disposed = false;
	return {
		admittedRunRequests: topology.add(
			project(
				graph,
				runtime,
				`${name}/admittedRunRequests`,
				"localHostExecutionGateRequests",
				(fact) => (fact.kind === "request" ? fact.request : undefined),
			),
		),
		status: topology.add(
			project(graph, runtime, `${name}/status`, "localHostExecutionGateStatus", (fact) =>
				fact.kind === "status" ? fact.status : undefined,
			),
		),
		issues: topology.add(
			project(graph, runtime, `${name}/issues`, "localHostExecutionGateIssues", (fact) =>
				fact.kind === "issue" ? fact.issue : undefined,
			),
		),
		audit: topology.add(
			project(graph, runtime, `${name}/audit`, "localHostExecutionGateAudit", (fact) =>
				fact.kind === "audit" ? fact.audit : undefined,
			),
		),
		dispose() {
			if (disposed) return;
			try {
				topology.release({ reason: `${name}:dispose` });
				disposed = true;
			} catch {
				// Public output subscribers are caller-owned. Keep the released gate
				// inspectable until callers unsubscribe, then allow dispose to retry.
			}
		},
	};
}

function reduceGate(ctx: Ctx, opts: LocalHostExecutionGateOptions): void {
	const state = ctx.state.get<GateState>() ?? emptyState();
	let dep = 0;
	for (const raw of depBatch(ctx, dep++) ?? []) {
		try {
			assertPlainData(raw, "tool-provider adapter input");
			const input = snapshotPlainData(raw) as ToolProviderAdapterInput;
			if (!boundedIdentity(input.adapterInputId))
				throw new TypeError("Invalid adapter input identity.");
			state.inputs.set(input.adapterInputId, input);
		} catch (error) {
			emitIssue(ctx, "invalid-execution-environment-input", error);
		}
	}
	for (let index = 0; index < opts.profiles.length; index += 1) {
		for (const raw of depBatch(ctx, dep++) ?? []) {
			try {
				const profile = environmentPinnedExecutorProfile(raw as EnvironmentPinnedExecutorProfile);
				state.profiles.set(profile.profileId, profile);
			} catch (error) {
				emitIssue(ctx, "invalid-execution-environment-profile", error);
			}
		}
	}
	for (let index = 0; index < opts.routes.length; index += 1) {
		for (const raw of depBatch(ctx, dep++) ?? []) {
			try {
				const route = environmentPinnedExecutorRoute(raw as EnvironmentPinnedExecutorRoute);
				state.routes.set(route.routeId, route);
			} catch (error) {
				emitIssue(ctx, "invalid-execution-environment-route", error);
			}
		}
	}
	for (let index = 0; index < opts.admittedRunRequests.length; index += 1) {
		for (const raw of depBatch(ctx, dep++) ?? []) {
			try {
				assertPlainData(raw, "admitted environment-pinned run");
			} catch (error) {
				emitIssue(ctx, "invalid-execution-environment-run", error);
				continue;
			}
			const request = snapshotPlainData(raw) as ToolProviderAdapterRunRequested;
			if (
				![request.runId, request.adapterInputId, request.requestId, request.operationId].every(
					boundedIdentity,
				) ||
				!Number.isSafeInteger(request.attempt) ||
				request.attempt < 1
			) {
				emitIssue(
					ctx,
					"invalid-execution-environment-run",
					new TypeError("Invalid run coordinates."),
				);
				continue;
			}
			const fingerprint = requestFingerprint(request);
			const previous = state.fingerprints.get(request.runId);
			if (previous !== undefined && previous !== fingerprint) {
				emitBlocked(
					ctx,
					request,
					"environment-run-conflict",
					"Run identity was reused with different environment material.",
				);
				continue;
			}
			state.fingerprints.set(request.runId, fingerprint);
			state.requests.set(request.runId, request);
		}
	}
	for (const request of state.requests.values())
		evaluateRequest(ctx, state, request, opts.now?.() ?? Date.now());
	ctx.state.set(state);
}

function evaluateRequest(
	ctx: Ctx,
	state: GateState,
	request: ToolProviderAdapterRunRequested,
	now: number,
): void {
	const input = state.inputs.get(request.adapterInputId);
	const profile =
		request.profileId === undefined ? undefined : state.profiles.get(request.profileId);
	const route = request.routeId === undefined ? undefined : state.routes.get(request.routeId);
	if (input === undefined || profile === undefined || route === undefined) {
		emitStatus(ctx, state, request, undefined, "waiting", "awaiting-environment-evidence");
		return;
	}
	const target = profile.executionEnvironment;
	const metadata = runMetadata(request);
	if (
		!requestMatchesInput(request, input) ||
		!inputMatchesProfileRoute(input, profile, route) ||
		route.executionEnvironment.environmentId !== target.environmentId ||
		route.executionEnvironment.revision !== target.revision ||
		metadata === undefined ||
		metadata.executionEnvironmentId !== target.environmentId ||
		metadata.executionEnvironmentRevision !== target.revision ||
		metadata.executionEnvironmentLocality !== target.locality ||
		metadata.executionEnvironmentBindingKind !== target.bindingKind
	) {
		emitBlocked(
			ctx,
			request,
			"execution-environment-mismatch",
			"Exact environment correlation failed.",
			state,
			target,
		);
		return;
	}
	if (
		target.locality !== "local" ||
		target.bindingKind !== "local-host-process" ||
		target.readiness.state !== "ready"
	) {
		emitBlocked(
			ctx,
			request,
			"execution-environment-unavailable",
			"This binding supports only a ready local host process.",
			state,
			target,
		);
		return;
	}
	if (target.readiness.expiresAtMs <= now) {
		emitBlocked(
			ctx,
			request,
			"execution-environment-stale",
			"Execution environment readiness has expired.",
			state,
			target,
		);
		return;
	}
	const fingerprint = `admitted:${requestFingerprint(request)}`;
	if (state.emitted.get(request.runId) === fingerprint) return;
	state.emitted.set(request.runId, fingerprint);
	ctx.down([
		["DATA", { kind: "request", request }],
		[
			"DATA",
			{
				kind: "status",
				status: gateStatus(request, target, "admitted", "local-host-process-admitted"),
			},
		],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: canonicalTupleKey(["local-host-execution-admitted", request.runId]),
					kind: "local-host-execution-admitted",
					subjectId: request.runId,
					message: "Exact D419-admitted run passed the local host process environment gate.",
					sourceRefs: Object.freeze([
						{ kind: "execution-environment", id: `${target.environmentId}@${target.revision}` },
					]),
					metadata: Object.freeze({
						requestId: request.requestId,
						operationId: request.operationId,
					}),
				} satisfies AgentRuntimeAuditRecord,
			},
		],
	]);
}

function emitBlocked(
	ctx: Ctx,
	request: ToolProviderAdapterRunRequested,
	code: string,
	message: string,
	state?: GateState,
	target?: ExecutionEnvironmentTarget,
): void {
	if (state !== undefined) {
		const fingerprint = `blocked:${code}:${requestFingerprint(request)}`;
		if (state.emitted.get(request.runId) === fingerprint) return;
		state.emitted.set(request.runId, fingerprint);
	}
	ctx.down([
		["DATA", { kind: "status", status: gateStatus(request, target, "blocked", code) }],
		["DATA", { kind: "issue", issue: issue(code, message, request.runId) }],
	]);
}

function emitStatus(
	ctx: Ctx,
	state: GateState,
	request: ToolProviderAdapterRunRequested,
	target: ExecutionEnvironmentTarget | undefined,
	gateState: LocalHostExecutionGateState,
	code: string,
): void {
	const fingerprint = `${gateState}:${code}:${requestFingerprint(request)}`;
	if (state.emitted.get(request.runId) === fingerprint) return;
	state.emitted.set(request.runId, fingerprint);
	ctx.down([["DATA", { kind: "status", status: gateStatus(request, target, gateState, code) }]]);
}

function gateStatus(
	request: ToolProviderAdapterRunRequested,
	target: ExecutionEnvironmentTarget | undefined,
	state: LocalHostExecutionGateState,
	code: string,
): LocalHostExecutionGateStatus {
	return Object.freeze({
		kind: "local-host-execution-gate-status",
		runId: request.runId,
		requestId: request.requestId,
		operationId: request.operationId,
		routeId: request.routeId,
		profileId: request.profileId,
		environmentId: target?.environmentId,
		environmentRevision: target?.revision,
		state,
		code,
	});
}

function requestMatchesInput(
	request: ToolProviderAdapterRunRequested,
	input: ToolProviderAdapterInput,
): boolean {
	return (
		request.adapterInputId === input.adapterInputId &&
		request.requestId === input.requestId &&
		request.operationId === input.operationId &&
		request.routeId !== undefined &&
		request.routeId === input.routeId &&
		request.executorId !== undefined &&
		request.executorId === input.executorId &&
		request.profileId !== undefined &&
		request.profileId === input.profileId
	);
}

function inputMatchesProfileRoute(
	input: ToolProviderAdapterInput,
	profile: EnvironmentPinnedExecutorProfile,
	route: EnvironmentPinnedExecutorRoute,
): boolean {
	return (
		input.status === "ready" &&
		input.requestId === route.requestId &&
		input.operationId === route.operationId &&
		input.adapterInputId === route.inputId &&
		input.toolCall?.kind === route.inputKind &&
		input.routeId === route.routeId &&
		input.executorId === route.executorId &&
		input.profileId === route.profileId &&
		profile.profileId === route.profileId &&
		profile.executorId === route.executorId &&
		(profile.acceptedInputKinds === undefined ||
			profile.acceptedInputKinds.includes(route.inputKind ?? "")) &&
		profileAcceptsSchemas(profile, input) &&
		(profile.requiredEnvironmentCapabilities === undefined ||
			profile.requiredEnvironmentCapabilities.every((capability) =>
				profile.executionEnvironment.capabilities?.includes(capability),
			))
	);
}

function profileAcceptsSchemas(
	profile: EnvironmentPinnedExecutorProfile,
	input: ToolProviderAdapterInput,
): boolean {
	if (profile.acceptedSchemaRefs === undefined) return true;
	const refs = new Set<string>();
	for (const ref of input.tool?.schemaRefs ?? []) if (boundedIdentity(ref)) refs.add(ref);
	const args = input.toolCall?.arguments;
	if (args !== null && typeof args === "object" && !Array.isArray(args)) {
		const schemaRef = (args as Record<string, unknown>).schemaRef;
		if (boundedIdentity(schemaRef)) refs.add(schemaRef);
	}
	return refs.size > 0 && [...refs].every((ref) => profile.acceptedSchemaRefs?.includes(ref));
}

function runMetadata(
	request: ToolProviderAdapterRunRequested,
): ExecutionEnvironmentPinnedRunMetadata | undefined {
	const metadata = request.metadata;
	if (metadata === undefined) return undefined;
	const candidate = {
		executionEnvironmentId: metadata.executionEnvironmentId,
		executionEnvironmentRevision: metadata.executionEnvironmentRevision,
		executionEnvironmentLocality: metadata.executionEnvironmentLocality,
		executionEnvironmentBindingKind: metadata.executionEnvironmentBindingKind,
		executionSessionEpoch: metadata.executionSessionEpoch,
	};
	if (
		!boundedIdentity(candidate.executionEnvironmentId) ||
		!boundedIdentity(candidate.executionEnvironmentRevision) ||
		!["local", "managed-cloud", "customer-hosted"].includes(
			String(candidate.executionEnvironmentLocality),
		) ||
		!["local-host-process", "local-container", "remote-session"].includes(
			String(candidate.executionEnvironmentBindingKind),
		) ||
		!boundedIdentity(candidate.executionSessionEpoch)
	)
		return undefined;
	return candidate as ExecutionEnvironmentPinnedRunMetadata;
}

function requestFingerprint(request: ToolProviderAdapterRunRequested): string {
	const metadata = runMetadata(request);
	return JSON.stringify([
		request.runId,
		request.adapterInputId,
		request.requestId,
		request.operationId,
		request.routeId,
		request.providerId,
		request.executorId,
		request.profileId,
		request.attempt,
		metadata?.executionEnvironmentId,
		metadata?.executionEnvironmentRevision,
		metadata?.executionEnvironmentLocality,
		metadata?.executionEnvironmentBindingKind,
		metadata?.executionSessionEpoch,
	]);
}

function project<T>(
	graph: Graph,
	source: Node<GateFact>,
	name: string,
	factory: string,
	pick: (fact: GateFact) => T | undefined,
): Node<T> {
	return graph.node<T>(
		[source],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = pick(raw as GateFact);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function emptyState(): GateState {
	return {
		inputs: new Map(),
		profiles: new Map(),
		routes: new Map(),
		requests: new Map(),
		fingerprints: new Map(),
		emitted: new Map(),
	};
}

function snapshotReadiness(value: ExecutionEnvironmentReadiness): ExecutionEnvironmentReadiness {
	if (!["ready", "stale", "unavailable"].includes(value.state))
		throw new TypeError("Invalid readiness state.");
	if (
		!Number.isSafeInteger(value.observedAtMs) ||
		!Number.isSafeInteger(value.expiresAtMs) ||
		value.expiresAtMs < value.observedAtMs
	)
		throw new TypeError("Invalid readiness window.");
	return Object.freeze({
		...value,
		attestationRefs:
			value.attestationRefs === undefined ? undefined : snapshotRefs(value.attestationRefs),
	});
}

function snapshotLimits(
	value: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> | undefined {
	if (value === undefined) return undefined;
	const entries = Object.entries(value);
	if (entries.length > MAX_LIMITS) throw new TypeError("Too many environment limits.");
	const result: Record<string, number> = {};
	for (const [key, amount] of entries) {
		if (!SAFE.test(key) || FORBIDDEN.test(key) || !Number.isFinite(amount) || amount < 0)
			throw new TypeError("Invalid environment limit.");
		result[key] = amount;
	}
	return Object.freeze(result);
}

function snapshotStrings(
	values: readonly string[] | undefined,
	max: number,
	label: string,
): readonly string[] | undefined {
	if (values === undefined) return undefined;
	if (!Array.isArray(values) || values.length > max || Object.keys(values).length !== values.length)
		throw new TypeError(`Invalid ${label}.`);
	for (const value of values)
		if (!SAFE.test(value) || FORBIDDEN.test(value)) throw new TypeError(`Invalid ${label}.`);
	return Object.freeze([...values]);
}

function snapshotRefs(refs: readonly SourceRef[]): readonly SourceRef[] {
	if (!Array.isArray(refs) || refs.length > MAX_REFS || Object.keys(refs).length !== refs.length)
		throw new TypeError("Invalid environment refs.");
	return Object.freeze(
		refs.map((ref) => {
			if (!boundedIdentity(ref.kind) || !boundedIdentity(ref.id) || FORBIDDEN.test(ref.kind))
				throw new TypeError("Invalid environment ref.");
			return Object.freeze({ kind: ref.kind, id: ref.id });
		}),
	);
}

function assertCoordinate(value: ExecutionEnvironmentCoordinate, label: string): void {
	if (!SAFE.test(value.environmentId) || !SAFE.test(value.revision))
		throw new TypeError(`Invalid ${label} coordinate.`);
}

function assertPlainData(value: unknown, label: string, seen = new Set<object>()): void {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		typeof value === "undefined"
	)
		return;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`);
		return;
	}
	if (typeof value !== "object") throw new TypeError(`${label} must contain only inert data.`);
	if (seen.has(value as object)) throw new TypeError(`${label} must not contain cycles.`);
	if (Array.isArray(value)) {
		if (value.length > MAX_PLAIN_ENTRIES || Object.keys(value).length !== value.length)
			throw new TypeError(`${label} contains an invalid collection.`);
	} else if (Reflect.ownKeys(value).length > MAX_PLAIN_ENTRIES) {
		throw new TypeError(`${label} contains too many fields.`);
	}
	seen.add(value as object);
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== Array.prototype && proto !== null)
		throw new TypeError(`${label} must be inert plain data.`);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || FORBIDDEN.test(key))
			throw new TypeError(`${label} contains forbidden material.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor?.get !== undefined || descriptor?.set !== undefined)
			throw new TypeError(`${label} must not contain accessors.`);
		assertPlainData(descriptor?.value, label, seen);
	}
	seen.delete(value as object);
}

function snapshotPlainData(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return Object.freeze(value.map((entry) => snapshotPlainData(entry)));
	const snapshot: Record<string, unknown> = {};
	for (const key of Object.keys(value))
		snapshot[key] = snapshotPlainData((value as Record<string, unknown>)[key]);
	return Object.freeze(snapshot);
}

function boundedIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 512 &&
		Array.from(value).every((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code >= 32 && code !== 127;
		})
	);
}

function issue(code: string, message: string, runId?: string): DataIssue {
	return Object.freeze({
		kind: "issue",
		severity: "error",
		code,
		message,
		refs: runId === undefined ? undefined : Object.freeze([runId]),
	});
}

function emitIssue(ctx: Ctx, code: string, error: unknown): void {
	ctx.down([
		[
			"DATA",
			{
				kind: "issue",
				issue: issue(
					code,
					error instanceof Error ? error.message : "Invalid execution environment evidence.",
				),
			},
		],
	]);
}
