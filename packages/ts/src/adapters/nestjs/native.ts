/**
 * Nest-native provider bridge for GraphReFly boundary metadata (D484).
 *
 * This focused subpath is allowed to import Nest/RxJS. The dependency-light
 * `@graphrefly/ts/adapters/nestjs` structural layer stays Nest-free.
 */

import type {
	ArgumentsHost,
	CallHandler,
	CanActivate,
	ExceptionFilter,
	ExecutionContext,
	OnModuleDestroy,
	OnModuleInit,
	Provider,
} from "@nestjs/common";
import { Catch, HttpException, type NestInterceptor } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { from, type Observable } from "rxjs";
import {
	type CronSchedule,
	type FromCronOptions,
	matchesCron,
	parseCron,
} from "../../graph/sources.js";
import {
	bindingEmitOptions,
	bindingRequestId,
	createNestGraphBoundaryRunner,
	type DecoratorBoundMethod,
	type DecoratorHostConstructor,
	type GraphGuardDecision,
	getNestBoundaryBindings,
	isDataIssue,
	lowerHttpReplyPayload,
	lowerProtocolError,
	type NestBoundaryBindingMeta,
	type NestDiagnosticIngressBoundary,
	type NestGraphRunOptions,
	type NestHttpReplyBindingMeta,
	type NestHttpResponsePayload,
	type NestIngressBindingMeta,
	type NestIssueResponse,
	type NestProtocolErrorResponse,
	protocolError,
	resolveNestMethodKey,
	toNestHttp,
} from "../nestjs.js";

export const GRAPHREFLY_NEST_CRON_SCHEDULER = Symbol.for("graphrefly:nest:cron-scheduler");
export const GRAPHREFLY_NEST_EXCEPTION_FILTER = Symbol.for("graphrefly:nest:exception-filter");
export const GRAPHREFLY_NEST_LIFECYCLE_HOOKS = Symbol.for("graphrefly:nest:lifecycle-hooks");

export interface GraphNativeHostOptions<THost = unknown> extends NestGraphRunOptions<THost> {
	readonly host?: (context: ExecutionContext) => THost;
	readonly diagnosticBoundary?: NestDiagnosticIngressBoundary;
}

export interface GraphNativeHttpOptions<THost = unknown> extends GraphNativeHostOptions<THost> {
	readonly issueResponse?: NestIssueResponse<THost>;
	readonly protocolError?: NestProtocolErrorResponse<THost>;
}

export type GraphGuardDecisionWait<THost = unknown> =
	| { readonly mode?: "same-wave" }
	| {
			readonly mode: "await";
			readonly timeoutMs: number;
			readonly maxPending: number;
			readonly scope: NestGraphGuardAwaitScope;
			readonly hostAbortSignal?: (
				context: ExecutionContext,
				host: THost,
			) => AbortSignal | undefined;
	  };

export interface GraphNativeGuardOptions<THost = unknown> extends GraphNativeHttpOptions<THost> {
	readonly decisionWait?: GraphGuardDecisionWait<THost>;
}

/** Host-private cancellation lookup for an explicitly asynchronous guard projector. */
export interface NestGraphGuardAwaitScope {
	lookupAbortSignal(invocationId: string): AbortSignal | undefined;
	dispose(): void;
}

interface NestGraphGuardAwaitScopeState {
	active: boolean;
	readonly entries: Map<string, AbortController>;
}

const graphGuardAwaitScopeStates = new WeakMap<
	NestGraphGuardAwaitScope,
	NestGraphGuardAwaitScopeState
>();

/** Creates the host-private bounded cancellation scope used by await-mode GraphGuard adapters. */
export function createNestGraphGuardAwaitScope(): NestGraphGuardAwaitScope {
	const state: NestGraphGuardAwaitScopeState = { active: true, entries: new Map() };
	const scope: NestGraphGuardAwaitScope = {
		lookupAbortSignal(invocationId) {
			return state.entries.get(invocationId)?.signal;
		},
		dispose() {
			if (!state.active) return;
			state.active = false;
			for (const controller of state.entries.values()) controller.abort();
			state.entries.clear();
		},
	};
	graphGuardAwaitScopeStates.set(scope, state);
	return scope;
}

export interface GraphExceptionFilterTarget {
	readonly target: DecoratorHostConstructor | object;
	readonly methodKey: string | symbol;
}

export interface GraphExceptionFilterProviderOptions<THost = unknown> {
	readonly host?: (host: ArgumentsHost, exception: unknown) => THost;
	readonly target: (
		host: ArgumentsHost,
		exception: unknown,
	) => GraphExceptionFilterTarget | undefined;
	readonly diagnosticBoundary?: NestDiagnosticIngressBoundary;
	readonly requestId?: string | ((host: THost) => string | undefined);
	readonly issueResponse?: NestIssueResponse<THost>;
	readonly protocolError?: NestProtocolErrorResponse<THost>;
}

export interface GraphCronProviderTarget<THost = unknown> {
	readonly target: DecoratorHostConstructor | object;
	readonly methodKey?: string | symbol;
	readonly expr: string;
	readonly tickMs?: number;
	readonly timezone?: string;
	readonly dst?: FromCronOptions["dst"];
	readonly host?: (date: Date) => THost;
}

export interface GraphCronSchedulerProviderOptions {
	readonly targets: readonly GraphCronProviderTarget[];
}

export interface GraphCronController {
	check(now: Date): void;
}

export interface GraphCronControllerOptions {
	readonly targets: readonly GraphCronProviderTarget[];
}

export interface GraphLifecycleProviderTarget<THost = unknown> {
	readonly target: DecoratorHostConstructor | object;
	readonly methodKey?: string | symbol;
	readonly event?: "module-init" | "module-destroy";
	readonly host?: (event: "module-init" | "module-destroy") => THost;
}

export interface GraphLifecycleHooksProviderOptions {
	readonly targets: readonly GraphLifecycleProviderTarget[];
}

export interface GraphNativeHttpProviderBundleOptions<THost = unknown> {
	readonly boundaryInterceptor?: GraphNativeHttpOptions<THost> | false;
	readonly guard?: GraphNativeGuardOptions<THost> | false;
	readonly guardDeniedFilter?: boolean;
	readonly exceptionFilter?: GraphExceptionFilterProviderOptions<THost>;
}

export interface GraphNativeProviderBundleOptions<THost = unknown> {
	readonly http?: GraphNativeHttpProviderBundleOptions<THost> | false;
	readonly cronScheduler?: GraphCronSchedulerProviderOptions;
	readonly lifecycleHooks?: GraphLifecycleHooksProviderOptions;
}

/**
 * Creates Nest provider bindings for graph boundary interceptor.
 *
 * @param opts - Options that configure the helper.
 * @returns Nest provider definitions for the requested boundary.
 * @category adapters
 * @example
 * ```ts
 * import { provideGraphBoundaryInterceptor } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function provideGraphBoundaryInterceptor<THost = unknown>(
	opts: GraphNativeHttpOptions<THost> = {},
): Provider {
	return { provide: APP_INTERCEPTOR, useValue: new GraphBoundaryInterceptorBridge(opts) };
}

/**
 * Creates Nest provider bindings for graph guard.
 *
 * @param opts - Options that configure the helper.
 * @returns Nest provider definitions for the requested boundary.
 * @category adapters
 * @example
 * ```ts
 * import { provideGraphGuard } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function provideGraphGuard<THost = unknown>(
	opts: GraphNativeGuardOptions<THost> = {},
): Provider {
	return { provide: APP_GUARD, useValue: new GraphGuardBridge(opts) };
}

/**
 * Creates Nest provider bindings for graph exception filter.
 *
 * @param opts - Options that configure the helper.
 * @returns Nest provider definitions for the requested boundary.
 * @category adapters
 * @example
 * ```ts
 * import { provideGraphExceptionFilter } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function provideGraphExceptionFilter<THost = unknown>(
	opts: GraphExceptionFilterProviderOptions<THost>,
): Provider {
	return { provide: GRAPHREFLY_NEST_EXCEPTION_FILTER, useValue: createGraphExceptionFilter(opts) };
}

/**
 * Creates a graph exception filter.
 *
 * @param opts - Options that configure the helper.
 * @returns The create graph exception filter result.
 * @category adapters
 * @example
 * ```ts
 * import { createGraphExceptionFilter } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function createGraphExceptionFilter<THost = unknown>(
	opts: GraphExceptionFilterProviderOptions<THost>,
): ExceptionFilter & OnModuleDestroy {
	return new GraphExceptionFilterBridge(opts);
}

/**
 * Creates Nest provider bindings for graph guard denied filter.
 *
 * @returns Nest provider definitions for the requested boundary.
 * @category adapters
 * @example
 * ```ts
 * import { provideGraphGuardDeniedFilter } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function provideGraphGuardDeniedFilter(): Provider {
	return GraphGuardDeniedFilter;
}

/**
 * Creates a graph guard denied filter.
 *
 * @returns The create graph guard denied filter result.
 * @category adapters
 * @example
 * ```ts
 * import { createGraphGuardDeniedFilter } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function createGraphGuardDeniedFilter(): ExceptionFilter {
	return new GraphGuardDeniedFilter();
}

/**
 * Creates Nest provider bindings for graph cron scheduler.
 *
 * @param opts - Options that configure the helper.
 * @returns Nest provider definitions for the requested boundary.
 * @category adapters
 * @example
 * ```ts
 * import { provideGraphCronScheduler } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function provideGraphCronScheduler(opts: GraphCronSchedulerProviderOptions): Provider {
	return { provide: GRAPHREFLY_NEST_CRON_SCHEDULER, useValue: new GraphCronSchedulerBridge(opts) };
}

/**
 * Creates Nest provider bindings for graph lifecycle hooks.
 *
 * @param opts - Options that configure the helper.
 * @returns Nest provider definitions for the requested boundary.
 * @category adapters
 * @example
 * ```ts
 * import { provideGraphLifecycleHooks } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function provideGraphLifecycleHooks(opts: GraphLifecycleHooksProviderOptions): Provider {
	return {
		provide: GRAPHREFLY_NEST_LIFECYCLE_HOOKS,
		useValue: new GraphLifecycleHooksBridge(opts),
	};
}

/**
 * Creates Nest provider bindings for graph native HTTP providers.
 *
 * @param opts - Options that configure the helper.
 * @returns Nest provider definitions for the requested boundary.
 * @category adapters
 * @example
 * ```ts
 * import { provideGraphNativeHttpProviders } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function provideGraphNativeHttpProviders<THost = unknown>(
	opts: GraphNativeHttpProviderBundleOptions<THost> = {},
): Provider[] {
	const providers: Provider[] = [];
	if (opts.boundaryInterceptor !== false)
		providers.push(provideGraphBoundaryInterceptor(opts.boundaryInterceptor ?? {}));
	if (opts.guard !== false) providers.push(provideGraphGuard(opts.guard ?? {}));
	if (opts.guardDeniedFilter ?? true) providers.push(provideGraphGuardDeniedFilter());
	if (opts.exceptionFilter !== undefined)
		providers.push(provideGraphExceptionFilter(opts.exceptionFilter));
	return providers;
}

/**
 * Creates Nest provider bindings for graph native providers.
 *
 * @param opts - Options that configure the helper.
 * @returns Nest provider definitions for the requested boundary.
 * @category adapters
 * @example
 * ```ts
 * import { provideGraphNativeProviders } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function provideGraphNativeProviders<THost = unknown>(
	opts: GraphNativeProviderBundleOptions<THost> = {},
): Provider[] {
	const providers: Provider[] = [];
	if (opts.http !== false) providers.push(...provideGraphNativeHttpProviders(opts.http ?? {}));
	if (opts.cronScheduler !== undefined)
		providers.push(provideGraphCronScheduler(opts.cronScheduler));
	if (opts.lifecycleHooks !== undefined)
		providers.push(provideGraphLifecycleHooks(opts.lifecycleHooks));
	return providers;
}

/**
 * Creates a graph cron target.
 *
 * @param target - Class or instance that owns the decorated method.
 * @param methodKey - Method key on the decorated target.
 * @param opts - Options that configure the helper.
 * @returns The graph cron target result.
 * @category adapters
 * @example
 * ```ts
 * import { graphCronTarget } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function graphCronTarget<THost = unknown>(
	target: DecoratorHostConstructor | object,
	methodKey: string | symbol,
	opts: Omit<GraphCronProviderTarget<THost>, "target" | "methodKey">,
): GraphCronProviderTarget<THost> {
	return { ...opts, target, methodKey };
}

/**
 * Creates a graph lifecycle target.
 *
 * @param target - Class or instance that owns the decorated method.
 * @param methodKey - Method key on the decorated target.
 * @param opts - Options that configure the helper.
 * @returns The graph lifecycle target result.
 * @category adapters
 * @example
 * ```ts
 * import { graphLifecycleTarget } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function graphLifecycleTarget<THost = unknown>(
	target: DecoratorHostConstructor | object,
	methodKey: string | symbol,
	opts: Omit<GraphLifecycleProviderTarget<THost>, "target" | "methodKey"> = {},
): GraphLifecycleProviderTarget<THost> {
	return { ...opts, target, methodKey };
}

/**
 * Creates a graph cron controller.
 *
 * @param opts - Options that configure the helper.
 * @returns The create graph cron controller result.
 * @category adapters
 * @example
 * ```ts
 * import { createGraphCronController } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function createGraphCronController(opts: GraphCronControllerOptions): GraphCronController {
	return new GraphCronControllerImpl(opts);
}

class GraphBoundaryInterceptorBridge<THost> implements NestInterceptor, OnModuleDestroy {
	private readonly runner: ReturnType<typeof createNestGraphBoundaryRunner>;

	constructor(private readonly opts: GraphNativeHttpOptions<THost>) {
		this.runner = createNestGraphBoundaryRunner({
			diagnosticBoundary: opts.diagnosticBoundary,
			diagnosticPhase: "http",
		});
	}

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const host = this.opts.host?.(context) ?? (defaultHttpHost(context) as THost);
		const result = this.runner.run(
			context.getClass(),
			methodKeyForContext(context),
			host,
			this.opts,
		);
		const reply = firstHttpReply(context);
		const value =
			result === undefined
				? next.handle()
				: Promise.resolve(result).then(
						(payload) =>
							writeHttpResponse(
								context,
								lowerHttpReplyPayload(payload, host, {
									issueResponse: reply?.issueResponse ?? this.opts.issueResponse,
								}),
							),
						(errorPayload) =>
							writeHttpResponse(
								context,
								lowerProtocolError(errorPayload, host, {
									protocolError: reply?.protocolError ?? this.opts.protocolError,
								}),
							),
					);
		return isObservableLike(value) ? value : from(Promise.resolve(value));
	}

	onModuleDestroy(): void {
		this.runner.dispose();
	}
}

let nextGraphGuardBridgeId = 0;

class GraphGuardBridge<THost> implements CanActivate, OnModuleDestroy {
	private readonly decisions = new WeakMap<
		object,
		Map<string, ReturnType<typeof toNestHttp<GraphGuardDecision>>>
	>();
	private readonly disposableDecisions = new Set<
		ReturnType<typeof toNestHttp<GraphGuardDecision>>
	>();
	private readonly bridgeId = ++nextGraphGuardBridgeId;
	private nextInvocationId = 0;
	private disposed = false;
	private readonly activeAwaitSettlements = new Set<() => void>();

	constructor(private readonly opts: GraphNativeGuardOptions<THost>) {
		validateGraphGuardDecisionWait(opts.decisionWait);
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		if (this.disposed) return false;
		const methodKey = methodKeyForContext(context);
		const bindings = getNestBoundaryBindings(context.getClass(), methodKey);
		const guards = bindings.filter(isGuardIngress);
		if (guards.length === 0) return true;
		const decisions = bindings.filter(isGuardDecision);
		if (decisions.length === 0) return false;
		const host = this.opts.host?.(context) ?? (defaultHttpHost(context) as THost);
		if (this.opts.decisionWait?.mode === "await") {
			return this.canActivateAwait(context, host, guards, decisions);
		}
		const guardEmits = guards.map((guard) => ({
			guard,
			requestId: bindingRequestId(host, guard, this.opts.requestId),
		}));
		if (guardEmits.some((entry) => entry.requestId === undefined)) return false;
		const requestIds = new Set(guardEmits.map((entry) => entry.requestId as string));
		const cleanups: Array<() => boolean> = [];
		try {
			const pending: GuardDecisionState[] = [];
			for (const requestId of requestIds) {
				for (const decision of decisions) {
					const state: GuardDecisionState = { status: "pending", binding: decision };
					pending.push(state);
					cleanups.push(
						this.decisionBoundary(decision).attach({
							requestId,
							bindingId: decision.bindingId,
							handle: {
								resolve(payload) {
									state.status = "resolved";
									state.payload = payload;
								},
								reject(error) {
									state.status = "rejected";
									state.error = error;
								},
							},
						}),
					);
				}
			}
			for (const entry of guardEmits)
				entry.guard.boundary.emit(host, bindingEmitOptions(host, entry.guard, entry.requestId));
			const rejected = pending.find((state) => state.status === "rejected");
			if (rejected !== undefined) {
				throw new GraphGuardProtocolErrorException(
					lowerProtocolError(rejected.error, host, {
						protocolError: rejected.binding.protocolError ?? this.opts.protocolError,
					}),
				);
			}
			if (pending.some((state) => state.status !== "resolved")) return false;
			const denied = pending.find(
				(
					state,
				): state is GuardDecisionState & {
					readonly status: "resolved";
					readonly payload: Extract<GraphGuardDecision, { readonly kind: "deny" }>;
				} => state.status === "resolved" && state.payload?.kind === "deny",
			);
			if (denied !== undefined) {
				throw new GraphGuardDeniedException(
					guardDecisionResponse(denied.payload, host, {
						issueResponse: denied.binding.issueResponse ?? this.opts.issueResponse,
					}),
				);
			}
			return pending.every((state) => state.payload?.kind === "allow");
		} catch (error) {
			if (isGraphGuardDeniedException(error) || error instanceof GraphGuardProtocolErrorException) {
				throw error;
			}
			return false;
		} finally {
			for (const cleanup of cleanups) cleanup();
		}
	}

	onModuleDestroy(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const settle of [...this.activeAwaitSettlements]) settle();
		this.activeAwaitSettlements.clear();
		for (const boundary of this.disposableDecisions) boundary.dispose();
		this.disposableDecisions.clear();
	}

	private async canActivateAwait(
		context: ExecutionContext,
		host: THost,
		guards: readonly NestIngressBindingMeta[],
		decisions: readonly NestGuardDecisionBindingMeta[],
	): Promise<boolean> {
		const wait = this.opts.decisionWait;
		if (wait?.mode !== "await") return false;
		const scopeState = graphGuardAwaitScopeStates.get(wait.scope);
		if (scopeState === undefined || !scopeState.active || this.disposed) return false;
		if (scopeState.entries.size >= wait.maxPending) {
			throw new GraphGuardDeniedException({
				status: 503,
				body: { code: "graphrefly.guard.overloaded" },
			});
		}

		const invocationId = `graphrefly:nest-guard:${this.bridgeId}:${++this.nextInvocationId}`;
		const controller = new AbortController();
		scopeState.entries.set(invocationId, controller);
		const cleanups: Array<() => boolean> = [];
		const pending: GuardDecisionState[] = [];
		let emittedGuardCount = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let hostSignal: AbortSignal | undefined;
		let settled = false;
		let settleWait: (() => void) | undefined;
		const waitForSettlement = new Promise<void>((resolve) => {
			settleWait = resolve;
		});
		const settle = () => {
			if (settled) return;
			settled = true;
			settleWait?.();
		};
		const maybeSettle = () => {
			if (pending.length > 0 && pending.every((state) => state.status !== "pending")) settle();
		};
		const abort = () => {
			controller.abort();
			settle();
		};

		this.activeAwaitSettlements.add(abort);
		controller.signal.addEventListener("abort", settle, { once: true });
		try {
			for (const decision of decisions) {
				const state: GuardDecisionState = { status: "pending", binding: decision };
				pending.push(state);
				cleanups.push(
					this.decisionBoundary(decision).attach({
						requestId: invocationId,
						bindingId: decision.bindingId,
						handle: {
							resolve(payload) {
								if (state.status !== "pending") return;
								state.premature = emittedGuardCount < guards.length;
								state.status = "resolved";
								state.payload = payload;
								maybeSettle();
							},
							reject(error) {
								if (state.status !== "pending") return;
								state.status = "rejected";
								state.error = error;
								maybeSettle();
							},
						},
					}),
				);
			}
			hostSignal = wait.hostAbortSignal?.(context, host);
			if (hostSignal?.aborted) abort();
			else hostSignal?.addEventListener("abort", abort, { once: true });
			timer = setTimeout(abort, wait.timeoutMs);
			if (!controller.signal.aborted) {
				for (const guard of guards) {
					emittedGuardCount += 1;
					guard.boundary.emit(host, bindingEmitOptions(host, guard, invocationId));
				}
			}
			maybeSettle();
			await waitForSettlement;
			if (controller.signal.aborted || this.disposed) return false;
			if (pending.some((state) => state.premature)) return false;
			const rejected = pending.find((state) => state.status === "rejected");
			if (rejected !== undefined) {
				throw new GraphGuardProtocolErrorException(
					lowerProtocolError(rejected.error, host, {
						protocolError: rejected.binding.protocolError ?? this.opts.protocolError,
					}),
				);
			}
			const denied = pending.find(
				(
					state,
				): state is GuardDecisionState & {
					readonly status: "resolved";
					readonly payload: Extract<GraphGuardDecision, { readonly kind: "deny" }>;
				} => state.status === "resolved" && state.payload?.kind === "deny",
			);
			if (denied !== undefined) {
				throw new GraphGuardDeniedException(
					guardDecisionResponse(denied.payload, host, {
						issueResponse: denied.binding.issueResponse ?? this.opts.issueResponse,
					}),
				);
			}
			return pending.every((state) => state.payload?.kind === "allow");
		} catch (error) {
			if (isGraphGuardDeniedException(error) || error instanceof GraphGuardProtocolErrorException) {
				throw error;
			}
			return false;
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			hostSignal?.removeEventListener("abort", abort);
			controller.signal.removeEventListener("abort", settle);
			for (const cleanup of cleanups) cleanup();
			controller.abort();
			scopeState.entries.delete(invocationId);
			this.activeAwaitSettlements.delete(abort);
		}
	}

	private decisionBoundary(
		binding: NestGuardDecisionBindingMeta,
	): ReturnType<typeof toNestHttp<GraphGuardDecision>> {
		const node = binding.decisionNode as object;
		let byBinding = this.decisions.get(node);
		if (byBinding === undefined) {
			byBinding = new Map();
			this.decisions.set(node, byBinding);
		}
		const existing = byBinding.get(binding.bindingId);
		if (existing !== undefined) return existing;
		const boundary = toNestHttp(binding.decisionNode, {
			bindingId: binding.bindingId,
			diagnosticBoundary: this.opts.diagnosticBoundary,
			diagnosticPhase: "guard",
		});
		byBinding.set(binding.bindingId, boundary);
		this.disposableDecisions.add(boundary);
		return boundary;
	}
}

/**
 * Represents a graph exception filter bridge.
 *
 * @category adapters
 * @example
 * ```ts
 * import { GraphExceptionFilterBridge } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export class GraphExceptionFilterBridge<THost> implements ExceptionFilter, OnModuleDestroy {
	private readonly replies = new WeakMap<
		object,
		Map<string, ReturnType<typeof toNestHttp<NestHttpReplyPayloadUnknown>>>
	>();
	private readonly disposableReplies = new Set<
		ReturnType<typeof toNestHttp<NestHttpReplyPayloadUnknown>>
	>();

	constructor(private readonly opts: GraphExceptionFilterProviderOptions<THost>) {}

	catch(exception: unknown, host: ArgumentsHost): unknown {
		const target = this.opts.target(host, exception);
		if (target === undefined) throw exception;
		const bindings = getNestBoundaryBindings(target.target, target.methodKey);
		const filters = bindings.filter(isErrorIngress);
		if (filters.length === 0) throw exception;
		const nativeHost =
			this.opts.host?.(host, exception) ?? (defaultArgumentsHost(host, exception) as THost);
		const filterEmits = filters.map((filter) => ({
			filter,
			requestId: bindingRequestId(nativeHost, filter, this.opts.requestId),
		}));
		const handleFilters = filterEmits.filter((entry) => entry.filter.mode !== "observe");
		const observeOnly = handleFilters.length === 0;
		const replies = bindings.filter(isHttpReply);
		const cleanups: Array<() => boolean> = [];
		const emitFilters = () => {
			for (const entry of filterEmits) {
				entry.filter.boundary.emit(
					nativeHost,
					bindingEmitOptions(nativeHost, entry.filter, entry.requestId),
				);
			}
		};
		if (observeOnly) {
			emitFilters();
			throw exception;
		}
		const requestIds = new Set(
			handleFilters
				.map((entry) => entry.requestId)
				.filter((requestId): requestId is string => requestId !== undefined),
		);
		if (replies.length === 0 || requestIds.size === 0) {
			for (const entry of filterEmits) {
				if (entry.requestId === undefined) continue;
				entry.filter.boundary.emit(
					nativeHost,
					bindingEmitOptions(nativeHost, entry.filter, entry.requestId),
				);
			}
			const filter = handleFilters[0]?.filter;
			const lowered = lowerCaughtException(exception, nativeHost, {
				issueResponse: filter?.issueResponse ?? this.opts.issueResponse,
				protocolError: filter?.protocolError ?? this.opts.protocolError,
			});
			return writeHttpResponse(host, lowered);
		}
		const pending: FilterReplyState[] = [];
		try {
			for (const requestId of requestIds) {
				for (const reply of replies) {
					const state: FilterReplyState = { status: "pending", reply };
					pending.push(state);
					cleanups.push(
						this.replyBoundary(reply).attach({
							requestId,
							bindingId: reply.bindingId,
							handle: {
								resolve(payload) {
									state.status = "resolved";
									state.payload = payload;
								},
								reject(error) {
									state.status = "rejected";
									state.error = error;
								},
							},
						}),
					);
				}
			}
			emitFilters();
			const resolved = pending.find((state) => state.status === "resolved");
			if (resolved !== undefined) {
				return writeHttpResponse(
					host,
					lowerHttpReplyPayload(resolved.payload, nativeHost, {
						issueResponse:
							resolved.reply.issueResponse ??
							handleFilters[0]?.filter.issueResponse ??
							this.opts.issueResponse,
					}),
				);
			}
			const rejected = pending.find((state) => state.status === "rejected");
			if (rejected !== undefined) {
				return writeHttpResponse(
					host,
					lowerProtocolError(rejected.error, nativeHost, {
						protocolError:
							rejected.reply.protocolError ??
							handleFilters[0]?.filter.protocolError ??
							this.opts.protocolError,
					}),
				);
			}
			const filter = handleFilters[0]?.filter;
			return writeHttpResponse(
				host,
				lowerCaughtException(exception, nativeHost, {
					issueResponse: filter?.issueResponse ?? this.opts.issueResponse,
					protocolError: filter?.protocolError ?? this.opts.protocolError,
				}),
			);
		} finally {
			for (const cleanup of cleanups) cleanup();
		}
	}

	onModuleDestroy(): void {
		for (const boundary of this.disposableReplies) boundary.dispose();
		this.disposableReplies.clear();
	}

	private replyBoundary(
		binding: NestHttpReplyBindingMeta,
	): ReturnType<typeof toNestHttp<NestHttpReplyPayloadUnknown>> {
		const node = binding.replyNode as object;
		let byBinding = this.replies.get(node);
		if (byBinding === undefined) {
			byBinding = new Map();
			this.replies.set(node, byBinding);
		}
		const existing = byBinding.get(binding.bindingId);
		if (existing !== undefined) return existing;
		const boundary = toNestHttp(binding.replyNode as NodeReplyPayload, {
			bindingId: binding.bindingId,
			diagnosticBoundary: this.opts.diagnosticBoundary,
			diagnosticPhase: "filter",
		});
		byBinding.set(binding.bindingId, boundary);
		this.disposableReplies.add(boundary);
		return boundary;
	}
}

class GraphCronControllerImpl implements GraphCronController {
	private readonly targets: Array<{
		readonly target: GraphCronProviderTarget;
		readonly schedule: CronSchedule;
		readonly fired: Set<string>;
	}>;

	constructor(opts: GraphCronControllerOptions) {
		this.targets = opts.targets.map((target) => ({
			target,
			schedule: parseCron(target.expr),
			fired: new Set<string>(),
		}));
	}

	check(now: Date): void {
		for (const entry of this.targets) {
			emitCronTarget(entry.target, entry.schedule, entry.fired, now);
		}
	}
}

class GraphCronSchedulerBridge implements OnModuleInit, OnModuleDestroy {
	private readonly timers: Array<ReturnType<typeof setInterval>> = [];

	constructor(private readonly opts: GraphCronSchedulerProviderOptions) {}

	onModuleInit(): void {
		try {
			for (const target of this.opts.targets) this.startTarget(target);
		} catch (error) {
			this.onModuleDestroy();
			throw error;
		}
	}

	onModuleDestroy(): void {
		for (const timer of this.timers.splice(0)) clearInterval(timer);
	}

	private startTarget(target: GraphCronProviderTarget): void {
		const tickMs = target.tickMs ?? 60_000;
		if (!Number.isFinite(tickMs) || tickMs <= 0) {
			throw new RangeError("provideGraphCronScheduler: tickMs must be a positive finite number");
		}
		const controller = createGraphCronController({ targets: [target] });
		const check = () => controller.check(new Date());
		check();
		this.timers.push(setInterval(check, tickMs));
	}
}

class GraphLifecycleHooksBridge implements OnModuleInit, OnModuleDestroy {
	constructor(private readonly opts: GraphLifecycleHooksProviderOptions) {}

	onModuleInit(): void {
		this.emit("module-init");
	}

	onModuleDestroy(): void {
		this.emit("module-destroy");
	}

	private emit(event: "module-init" | "module-destroy"): void {
		for (const target of this.opts.targets) {
			if (target.event !== undefined && target.event !== event) continue;
			const host = target.host?.(event) ?? { event };
			for (const binding of lifecycleBindings(target)) {
				binding.boundary.emit(host, bindingEmitOptions(host, binding, undefined));
			}
		}
	}
}

type NestHttpReplyPayloadUnknown = unknown;
type NodeReplyPayload = Parameters<typeof toNestHttp<NestHttpReplyPayloadUnknown>>[0];
type NestGuardDecisionBindingMeta = Extract<NestBoundaryBindingMeta, { kind: "guard-decision" }>;
interface GuardDecisionState {
	status: "pending" | "resolved" | "rejected";
	binding: NestGuardDecisionBindingMeta;
	premature?: boolean;
	payload?: GraphGuardDecision;
	error?: unknown;
}

interface FilterReplyState {
	status: "pending" | "resolved" | "rejected";
	reply: NestHttpReplyBindingMeta;
	payload?: NestHttpReplyPayloadUnknown;
	error?: unknown;
}

function validateGraphGuardDecisionWait<THost>(
	wait: GraphGuardDecisionWait<THost> | undefined,
): void {
	if (wait?.mode !== "await") return;
	if (!Number.isFinite(wait.timeoutMs) || wait.timeoutMs <= 0) {
		throw new RangeError("provideGraphGuard: await timeoutMs must be a positive finite number");
	}
	if (!Number.isFinite(wait.maxPending) || wait.maxPending < 1) {
		throw new RangeError("provideGraphGuard: await maxPending must be a positive finite number");
	}
	if (Math.floor(wait.maxPending) !== wait.maxPending) {
		throw new RangeError("provideGraphGuard: await maxPending must be an integer");
	}
	if (!graphGuardAwaitScopeStates.has(wait.scope)) {
		throw new TypeError(
			"provideGraphGuard: await scope must be created by createNestGraphGuardAwaitScope",
		);
	}
}

function methodKeyForContext(context: ExecutionContext): string | symbol {
	const resolved = resolveNestMethodKey(
		context.getClass(),
		context.getHandler() as DecoratorBoundMethod,
	);
	return resolved ?? context.getHandler().name;
}

function defaultHttpHost(context: ExecutionContext): unknown {
	const request = context.switchToHttp?.().getRequest?.();
	return request ?? {};
}

function defaultArgumentsHost(host: ArgumentsHost, exception: unknown): unknown {
	const request = host.switchToHttp?.().getRequest?.();
	if (request !== undefined && request !== null) return { ...request, exception };
	return { exception };
}

function isObservableLike(value: unknown): value is Observable<unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		typeof (value as { subscribe?: unknown }).subscribe === "function"
	);
}

function isGuardIngress(binding: NestBoundaryBindingMeta): binding is NestIngressBindingMeta {
	return binding.direction === "ingress" && binding.kind === "guard";
}

function isErrorIngress(binding: NestBoundaryBindingMeta): binding is NestIngressBindingMeta {
	return binding.direction === "ingress" && binding.kind === "error";
}

function isHttpReply(binding: NestBoundaryBindingMeta): binding is NestHttpReplyBindingMeta {
	return binding.direction === "egress" && binding.kind === "http";
}

function isGuardDecision(
	binding: NestBoundaryBindingMeta,
): binding is NestGuardDecisionBindingMeta {
	return binding.direction === "egress" && binding.kind === "guard-decision";
}

function firstHttpReply(context: ExecutionContext): NestHttpReplyBindingMeta | undefined {
	return getNestBoundaryBindings(context.getClass(), methodKeyForContext(context)).find(
		isHttpReply,
	);
}

function lifecycleBindings(
	target: GraphLifecycleProviderTarget,
): readonly NestIngressBindingMeta[] {
	return getNestBoundaryBindings(target.target, target.methodKey).filter(
		(binding): binding is NestIngressBindingMeta =>
			binding.direction === "ingress" && binding.kind === "lifecycle",
	);
}

function cronBindings(target: GraphCronProviderTarget): readonly NestIngressBindingMeta[] {
	return getNestBoundaryBindings(target.target, target.methodKey).filter(
		(binding): binding is NestIngressBindingMeta =>
			binding.direction === "ingress" && binding.kind === "cron",
	);
}

function emitCronTarget(
	target: GraphCronProviderTarget,
	schedule: CronSchedule,
	fired: Set<string>,
	now: Date,
): void {
	if (!matchesCron(schedule, now, { timezone: target.timezone })) return;
	const key = cronProviderMinuteKey(now, target.timezone);
	for (const existing of fired) {
		if (!existing.startsWith(`${key.dayKey}:`)) fired.delete(existing);
	}
	if (fired.has(key.minuteKey)) return;
	fired.add(key.minuteKey);
	const host =
		target.host?.(now) ??
		({
			iso: now.toISOString(),
			timestamp_ms: now.getTime(),
			timestamp_ns: (BigInt(now.getTime()) * 1_000_000n).toString(),
			timezone: target.timezone,
		} satisfies Record<string, unknown>);
	for (const binding of cronBindings(target)) {
		binding.boundary.emit(host, bindingEmitOptions(host, binding, undefined));
	}
}

function cronProviderMinuteKey(
	date: Date,
	timezone?: string,
): { readonly dayKey: string; readonly minuteKey: string } {
	if (timezone === undefined) {
		const dayKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
		return { dayKey, minuteKey: `${dayKey}:${date.getHours()}:${date.getMinutes()}` };
	}
	const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const byType = new Map(parts.map((part) => [part.type, part.value]));
	const dayKey = `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
	return { dayKey, minuteKey: `${dayKey}:${byType.get("hour")}:${byType.get("minute")}` };
}

function lowerCaughtException<THost>(
	exception: unknown,
	host: THost,
	opts: {
		readonly issueResponse?: NestIssueResponse<THost>;
		readonly protocolError?: NestProtocolErrorResponse<THost>;
	},
): ReturnType<typeof lowerHttpReplyPayload> {
	if (isDataIssue(exception)) return lowerHttpReplyPayload(exception, host, opts);
	return (opts.protocolError ?? protocolError)(exception, host);
}

function guardDecisionResponse<THost>(
	decision: Extract<GraphGuardDecision, { readonly kind: "deny" }>,
	host: THost,
	opts: { readonly issueResponse?: NestIssueResponse<THost> },
): NestHttpResponsePayload {
	if (decision.issue !== undefined) return lowerHttpReplyPayload(decision.issue, host, opts);
	if (Number.isInteger(decision.status)) {
		return {
			status: decision.status as number,
			body: decision.body ?? {
				code: "graphrefly.guard_denied",
				message: decision.reason ?? "GraphReFly guard denied request",
			},
			headers: decision.headers,
		};
	}
	return {
		status: 403,
		body: {
			code: "graphrefly.guard_denied",
			message: decision.reason ?? "GraphReFly guard denied request",
		},
		headers: decision.headers,
	};
}

/**
 * Represents a graph guard denied exception.
 *
 * @category adapters
 * @example
 * ```ts
 * import { GraphGuardDeniedException } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export class GraphGuardDeniedException extends HttpException {
	readonly payload: NestHttpResponsePayload;

	constructor(payload: NestHttpResponsePayload) {
		super(payload.body ?? {}, payload.status);
		this.payload = payload;
	}
}

class GraphGuardProtocolErrorException extends HttpException {
	constructor(payload: NestHttpResponsePayload) {
		super(payload.body ?? {}, payload.status);
	}
}

/**
 * Checks whether a value is a graph guard denied exception.
 *
 * @param value - Unknown value to check or decode.
 * @returns `true` when the value matches the expected shape.
 * @category adapters
 * @example
 * ```ts
 * import { isGraphGuardDeniedException } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export function isGraphGuardDeniedException(value: unknown): value is GraphGuardDeniedException {
	return value instanceof GraphGuardDeniedException;
}

/**
 * Represents a graph guard denied filter.
 *
 * @category adapters
 * @example
 * ```ts
 * import { GraphGuardDeniedFilter } from "@graphrefly/ts/adapters/nestjs/native";
 * ```
 */
export class GraphGuardDeniedFilter implements ExceptionFilter {
	catch(exception: unknown, host: ArgumentsHost): unknown {
		if (!isGraphGuardDeniedException(exception)) throw exception;
		return writeHttpResponse(host, exception.payload);
	}
}

Catch(GraphGuardDeniedException)(GraphGuardDeniedFilter);

function writeHttpResponse(
	host: ArgumentsHost,
	payload: ReturnType<typeof lowerHttpReplyPayload>,
): unknown {
	const response = host.switchToHttp?.().getResponse?.() as
		| {
				status?: (status: number) => unknown;
				json?: (body: unknown) => unknown;
				send?: (body?: unknown) => unknown;
				setHeader?: (name: string, value: string) => void;
				header?: (name: string, value: string) => void;
		  }
		| undefined;
	if (response === undefined) return payload;
	for (const [name, value] of Object.entries(payload.headers ?? {})) {
		if (typeof response.setHeader === "function") response.setHeader(name, value);
		else response.header?.(name, value);
	}
	response.status?.(payload.status);
	if (typeof response.json === "function") return response.json(payload.body ?? {});
	if (typeof response.send === "function") return response.send(payload.body);
	return payload;
}
