/**
 * Focused NestJS boundary bindings for GraphReFly (D474/D478).
 *
 * This subpath stays dependency-light: it exposes graph boundary primitives,
 * token/provider shapes, and decorator metadata without importing Nest itself.
 * User-land Nest modules/controllers bind these helpers to real decorators and
 * host lifecycle objects at the framework edge.
 */

import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import type { Message } from "../protocol/messages.js";

export const NEST_BOUNDARY_ENVELOPE_VERSION = 1;
export const NEST_BOUNDARY_PAYLOAD_MAX_BYTES = 64 * 1024;
export const NEST_HTTP_DIAGNOSTICS_MAX_RETAINED = 100;

/** D478 minimal graph-visible transport envelope. Payload must be data-only. */
export interface NestBoundaryEnvelope<T = unknown> {
	readonly bindingId: string;
	readonly version: number;
	readonly payload: T;
	readonly requestId?: string;
}

/** Reply-capable egress must carry host-private request correlation (D478). */
export type NestReplyEnvelope<T = unknown> = NestBoundaryEnvelope<T> & {
	readonly requestId: string;
};

export type NestBoundaryKind =
	| "request"
	| "guard"
	| "interceptor"
	| "error"
	| "lifecycle"
	| "cron"
	| "diagnostics"
	| "ws"
	| "message";

export type NestEgressKind = "http" | "guard-decision" | "ws-ack" | "ws-reply" | "message-reply";
export type NestFilterMode = "handle" | "observe";
export type NestDiagnosticPhase =
	| "adapter"
	| "http"
	| "guard"
	| "filter"
	| "cron"
	| "lifecycle"
	| "ws"
	| "message"
	| NestBoundaryKind
	| NestEgressKind;

export interface NestHttpResponsePayload<TBody = unknown> {
	readonly status: number;
	readonly body?: TBody;
	readonly headers?: Record<string, string>;
}

export interface HttpDataIssue extends DataIssue {
	readonly status: number;
	readonly body?: unknown;
	readonly headers?: Record<string, string>;
}

export type NestIssueResponse<THost = unknown> = (
	issue: DataIssue,
	host: THost,
) => NestHttpResponsePayload;

export type NestProtocolErrorResponse<THost = unknown> = (
	errorPayload: unknown,
	host: THost,
) => NestHttpResponsePayload;

export type GraphGuardDecision =
	| {
			readonly kind: "allow";
			readonly reason?: string;
			readonly metadata?: Record<string, unknown>;
	  }
	| {
			readonly kind: "deny";
			readonly reason?: string;
			readonly status?: number;
			readonly body?: unknown;
			readonly headers?: Record<string, string>;
			readonly issue?: DataIssue | HttpDataIssue;
			readonly metadata?: Record<string, unknown>;
	  };

export interface NestBoundaryDiagnostic {
	readonly kind:
		| "binding-mismatch"
		| "dispose-pending"
		| "malformed-egress"
		| "stale-egress"
		| "terminal-egress"
		| "timeout"
		| "resolve-threw"
		| "reject-threw";
	readonly phase?: NestDiagnosticPhase;
	readonly requestId?: string;
	readonly bindingId?: string;
	readonly expectedBindingId?: string;
	readonly message: string;
	readonly error?: unknown;
}

export interface NestDiagnosticErrorPayload {
	readonly name?: string;
	readonly message: string;
}

export interface NestDiagnosticPayload {
	readonly kind: NestBoundaryDiagnostic["kind"];
	readonly phase: NestDiagnosticPhase;
	readonly requestId?: string;
	readonly bindingId?: string;
	readonly expectedBindingId?: string;
	readonly message: string;
	readonly error?: NestDiagnosticErrorPayload;
}

export interface NestDiagnosticInput extends NestBoundaryDiagnostic {
	readonly phase?: NestDiagnosticPhase;
}

export interface NestDiagnosticsOptions
	extends Omit<NestIngressOptions<NestDiagnosticInput, NestDiagnosticPayload>, "payload"> {
	readonly phase?: NestDiagnosticPhase;
}

export type NestDiagnosticIngressBoundary = NestIngressBoundary<
	NestDiagnosticInput,
	NestDiagnosticPayload
>;

export interface NestIngressBoundary<THost = unknown, TPayload = THost> {
	readonly kind: NestBoundaryKind;
	readonly bindingId: string;
	readonly version: number;
	readonly node: Node<NestBoundaryEnvelope<TPayload>>;
	envelope(host: THost, opts?: NestIngressEmitOptions<TPayload>): NestBoundaryEnvelope<TPayload>;
	emit(host: THost, opts?: NestIngressEmitOptions<TPayload>): NestBoundaryEnvelope<TPayload>;
}

export interface NestIngressOptions<THost, TPayload> {
	readonly bindingId?: string;
	readonly name?: string;
	readonly version?: number;
	readonly maxPayloadBytes?: number;
	readonly requestId?: string | ((host: THost) => string | undefined);
	readonly requireRequestId?: boolean;
	readonly payload?: (host: THost) => TPayload;
}

export interface NestIngressEmitOptions<TPayload> {
	readonly requestId?: string;
	readonly bindingId?: string;
	readonly version?: number;
	readonly payload?: TPayload;
	readonly requireRequestId?: boolean;
}

export interface NestReplyResponseHandle<TPayload> {
	resolve(payload: TPayload, envelope: NestReplyEnvelope<TPayload>): void;
	reject(error: unknown, envelope?: NestReplyEnvelope<TPayload>): void;
}

export interface NestReplyPendingRegistration<TPayload> {
	readonly requestId: string;
	readonly handle: NestReplyResponseHandle<TPayload>;
	readonly bindingId?: string;
}

export interface NestReplyBoundary<TPayload = unknown> {
	readonly kind: NestEgressKind;
	readonly bindingId: string;
	attach(registration: NestReplyPendingRegistration<TPayload>): () => boolean;
	pendingCount(): number;
	diagnostics(): readonly NestBoundaryDiagnostic[];
	dispose(): void;
}

export interface NestHttpResponseHandle<TPayload> extends NestReplyResponseHandle<TPayload> {}

export interface NestHttpPendingRegistration<TPayload>
	extends NestReplyPendingRegistration<TPayload> {}

export interface NestHttpBoundary<TPayload = unknown> extends NestReplyBoundary<TPayload> {
	readonly kind: "http";
}

export interface ToNestHttpOptions<TPayload> {
	readonly bindingId?: string;
	readonly diagnosticBoundary?: NestDiagnosticIngressBoundary;
	readonly diagnosticPhase?: NestDiagnosticPhase;
	readonly maxDiagnostics?: number;
	readonly maxPayloadBytes?: number;
	readonly name?: string;
	readonly transform?: (payload: TPayload, envelope: NestReplyEnvelope<TPayload>) => TPayload;
	readonly label?: string;
}

interface NestReplyPendingEntry<TPayload> {
	readonly requestId: string;
	readonly bindingId?: string;
	readonly handle: NestReplyResponseHandle<TPayload>;
}

interface NestHttpPendingEntry<TPayload> extends NestReplyPendingEntry<TPayload> {}

export interface NestBoundaryDecoratorOptions<THost = unknown, TPayload = unknown> {
	readonly bindingId?: string;
	readonly payload?: (host: THost) => TPayload;
	readonly requestId?: string | ((host: THost) => string | undefined);
	readonly order?: number;
}

export interface NestFilterDecoratorOptions<THost = unknown, TPayload = unknown>
	extends NestBoundaryDecoratorOptions<THost, TPayload> {
	readonly mode?: NestFilterMode;
	readonly issueResponse?: NestIssueResponse<THost>;
	readonly protocolError?: NestProtocolErrorResponse<THost>;
}

export interface NestHttpReplyDecoratorOptions<THost = unknown> {
	readonly bindingId: string;
	readonly order?: number;
	readonly issueResponse?: NestIssueResponse<THost>;
	readonly protocolError?: NestProtocolErrorResponse<THost>;
}

export interface NestGuardDecisionDecoratorOptions<THost = unknown> {
	readonly bindingId: string;
	readonly order?: number;
	readonly issueResponse?: NestIssueResponse<THost>;
	readonly protocolError?: NestProtocolErrorResponse<THost>;
}

export interface NestGraphRunOptions<THost = unknown> {
	readonly requestId?: string | ((host: THost) => string | undefined);
}

export interface NestGraphBoundaryRunnerOptions {
	readonly diagnosticBoundary?: NestDiagnosticIngressBoundary;
	readonly diagnosticPhase?: NestDiagnosticPhase;
}

export interface NestGraphBoundaryRunner {
	run<THost = unknown>(
		target: DecoratorHostConstructor | object,
		methodKey: string | symbol,
		host: THost,
		opts?: NestGraphRunOptions<THost>,
	): Promise<unknown> | undefined;
	dispose(): void;
}

export interface NestExecutionContextLike {
	getClass(): DecoratorHostConstructor;
	getHandler(): DecoratorBoundMethod;
	switchToHttp?(): { getRequest<T = unknown>(): T };
}

export interface NestCallHandlerLike {
	handle(): unknown;
}

export interface NestGraphBoundaryInterceptorOptions<THost = unknown>
	extends NestGraphRunOptions<THost>,
		NestGraphBoundaryRunnerOptions {
	readonly host?: (context: NestExecutionContextLike) => THost;
	readonly runner?: NestGraphBoundaryRunner;
}

export interface NestGraphBoundaryInterceptor {
	intercept(
		context: NestExecutionContextLike,
		next?: NestCallHandlerLike,
	): Promise<unknown> | unknown;
	dispose(): void;
}

/** Injection token for a root graph singleton. */
export const GRAPHREFLY_ROOT_GRAPH = Symbol.for("graphrefly:root-graph");

/** Injection token for adapter module options. */
export const GRAPHREFLY_MODULE_OPTIONS = Symbol.for("graphrefly:module-options");

/** Injection token for a request-scoped graph. */
export const GRAPHREFLY_REQUEST_GRAPH = Symbol.for("graphrefly:request-graph");

export type DecoratorHostConstructor = abstract new (...args: unknown[]) => unknown;
export type DecoratorBoundMethod = (...args: unknown[]) => unknown;

export interface OnGraphEventMeta {
	nodeName: string;
	methodKey: string | symbol;
}

export interface GraphIntervalMeta {
	ms: number;
	methodKey: string | symbol;
}

export interface GraphCronMeta {
	expr: string;
	methodKey: string | symbol;
}

export type NestBoundaryBindingDirection = "ingress" | "egress";

export interface NestIngressBindingMeta {
	readonly direction: "ingress";
	kind: NestBoundaryKind;
	bindingId: string;
	methodKey: string | symbol;
	readonly boundary: NestIngressBoundary<unknown, unknown>;
	readonly payload?: (host: unknown) => unknown;
	readonly requestId?: string | ((host: unknown) => string | undefined);
	readonly order?: number;
	readonly mode?: NestFilterMode;
	readonly issueResponse?: NestIssueResponse<unknown>;
	readonly protocolError?: NestProtocolErrorResponse<unknown>;
}

export interface NestHttpReplyBindingMeta {
	readonly direction: "egress";
	readonly kind: "http";
	readonly bindingId: string;
	readonly methodKey: string | symbol;
	readonly replyNode: Node<NestReplyEnvelope<unknown>>;
	readonly order?: number;
	readonly issueResponse?: NestIssueResponse<unknown>;
	readonly protocolError?: NestProtocolErrorResponse<unknown>;
}

export interface NestGuardDecisionBindingMeta {
	readonly direction: "egress";
	readonly kind: "guard-decision";
	readonly bindingId: string;
	readonly methodKey: string | symbol;
	readonly decisionNode: Node<NestReplyEnvelope<GraphGuardDecision>>;
	readonly order?: number;
	readonly issueResponse?: NestIssueResponse<unknown>;
	readonly protocolError?: NestProtocolErrorResponse<unknown>;
}

export interface NestWsAckBindingMeta {
	readonly direction: "egress";
	readonly kind: "ws-ack";
	readonly bindingId: string;
	readonly methodKey: string | symbol;
	readonly ackNode: Node<NestReplyEnvelope<unknown>>;
	readonly order?: number;
}

export interface NestWsReplyBindingMeta {
	readonly direction: "egress";
	readonly kind: "ws-reply";
	readonly bindingId: string;
	readonly methodKey: string | symbol;
	readonly replyNode: Node<NestReplyEnvelope<unknown>>;
	readonly order?: number;
}

export interface NestMessageReplyBindingMeta {
	readonly direction: "egress";
	readonly kind: "message-reply";
	readonly bindingId: string;
	readonly methodKey: string | symbol;
	readonly replyNode: Node<NestReplyEnvelope<unknown>>;
	readonly order?: number;
}

export type NestBoundaryBindingMeta =
	| NestIngressBindingMeta
	| NestHttpReplyBindingMeta
	| NestGuardDecisionBindingMeta
	| NestWsAckBindingMeta
	| NestWsReplyBindingMeta
	| NestMessageReplyBindingMeta;

export const EVENT_HANDLERS = new WeakMap<DecoratorHostConstructor, OnGraphEventMeta[]>();
export const INTERVAL_HANDLERS = new WeakMap<DecoratorHostConstructor, GraphIntervalMeta[]>();
export const CRON_HANDLERS = new WeakMap<DecoratorHostConstructor, GraphCronMeta[]>();
export const NEST_BOUNDARY_BINDINGS = new WeakMap<
	DecoratorHostConstructor,
	NestBoundaryBindingMeta[]
>();

export type GraphMethodDecorator = MethodDecorator &
	((value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => void);

/** Minimal Nest provider object shape without importing @nestjs/common. */
export type NestProviderBinding<T = unknown> =
	| { readonly provide: string | symbol; readonly useValue: T }
	| { readonly provide: string | symbol; readonly useFactory: (...args: unknown[]) => T };

/** Get the injection token for a named feature graph. */
export function getGraphToken(name: string): symbol {
	assertNonEmptyString(name, "getGraphToken(name)");
	return Symbol.for(`graphrefly:graph:${name}`);
}

/** Get the injection token for a node at a qualified path. */
export function getNodeToken(path: string): symbol {
	assertNonEmptyString(path, "getNodeToken(path)");
	return Symbol.for(`graphrefly:node:${path}`);
}

/** Get the injection token for a named Nest boundary binding. */
export function getNestBoundaryToken(bindingId: string): symbol {
	assertNonEmptyString(bindingId, "getNestBoundaryToken(bindingId)");
	return Symbol.for(`graphrefly:nest-boundary:${bindingId}`);
}

/** Build a dependency-free provider binding shape for user-land Nest modules. */
export function nestProvider<T>(provide: string | symbol, useValue: T): NestProviderBinding<T> {
	return { provide, useValue };
}

/** D474 P0 HTTP request ingress. */
export function fromNestReq<THost = unknown, TPayload = THost>(
	graph: Graph,
	opts: NestIngressOptions<THost, TPayload> = {},
): NestIngressBoundary<THost, TPayload> {
	return nestIngress(graph, "request", opts);
}

/** D474 P0 guard/admission ingress. */
export function fromNestGuard<THost = unknown, TPayload = THost>(
	graph: Graph,
	opts: NestIngressOptions<THost, TPayload> = {},
): NestIngressBoundary<THost, TPayload> {
	return nestIngress(graph, "guard", opts);
}

/** D474 P1 interceptor ingress. */
export function fromNestIntercept<THost = unknown, TPayload = THost>(
	graph: Graph,
	opts: NestIngressOptions<THost, TPayload> = {},
): NestIngressBoundary<THost, TPayload> {
	return nestIngress(graph, "interceptor", opts);
}

/** D474 P0 error/filter ingress. */
export function fromNestError<THost = unknown, TPayload = THost>(
	graph: Graph,
	opts: NestIngressOptions<THost, TPayload> = {},
): NestIngressBoundary<THost, TPayload> {
	return nestIngress(graph, "error", opts);
}

/** D474 P1 Nest lifecycle hook ingress. */
export function fromNestLifecycle<THost = unknown, TPayload = THost>(
	graph: Graph,
	opts: NestIngressOptions<THost, TPayload> = {},
): NestIngressBoundary<THost, TPayload> {
	return nestIngress(graph, "lifecycle", opts);
}

/** D474 P1 schedule/cron ingress. */
export function fromNestCron<THost = unknown, TPayload = THost>(
	graph: Graph,
	opts: NestIngressOptions<THost, TPayload> = {},
): NestIngressBoundary<THost, TPayload> {
	return nestIngress(graph, "cron", opts);
}

/** D494 explicit graph-visible diagnostics ingress. Emits sanitized data-only payloads. */
export function fromNestDiagnostics(
	graph: Graph,
	opts: NestDiagnosticsOptions = {},
): NestDiagnosticIngressBoundary {
	return nestIngress<NestDiagnosticInput, NestDiagnosticPayload>(graph, "diagnostics", {
		...opts,
		payload: (diagnostic) => sanitizeNestDiagnostic(diagnostic, opts.phase),
	});
}

/** D474 later/optional WebSocket ingress. Kept thin for first-slice experiments. */
export function fromNestWs<THost = unknown, TPayload = THost>(
	graph: Graph,
	opts: NestIngressOptions<THost, TPayload> = {},
): NestIngressBoundary<THost, TPayload> {
	return nestIngress(graph, "ws", opts);
}

/** D474 later/optional microservice/message ingress. */
export function fromNestMessage<THost = unknown, TPayload = THost>(
	graph: Graph,
	opts: NestIngressOptions<THost, TPayload> = {},
): NestIngressBoundary<THost, TPayload> {
	return nestIngress(graph, "message", opts);
}

/**
 * D474 HTTP egress resolver.
 *
 * The returned boundary owns only a host-private pending map. It never stores
 * response/socket/ack handles in graph DATA and only resolves handles whose
 * requestId (and optional bindingId) match an egress envelope.
 */
export function toNestHttp<TPayload = unknown>(
	egress: Node<NestReplyEnvelope<TPayload>>,
	opts: ToNestHttpOptions<TPayload> = {},
): NestHttpBoundary<TPayload> {
	const bindingId = stableBindingId("http", opts);
	const scopedBindingId = opts.bindingId;
	const maxDiagnostics = diagnosticsRetainedLimit(opts.maxDiagnostics);
	const maxPayloadBytes = payloadByteLimit(opts.maxPayloadBytes);
	const pending = new Map<string, NestHttpPendingEntry<TPayload>>();
	const diagnostics: NestBoundaryDiagnostic[] = [];
	let active = true;
	let terminal:
		| {
				readonly error: unknown;
				readonly message: string;
		  }
		| undefined;

	const report = (diagnostic: NestBoundaryDiagnostic) => {
		pushDiagnostic(diagnostics, diagnostic, maxDiagnostics);
		try {
			const phase = diagnostic.phase ?? opts.diagnosticPhase ?? "http";
			const payload = sanitizeNestDiagnostic({ ...diagnostic, phase }, phase);
			opts.diagnosticBoundary?.emit(payload, { payload });
		} catch {
			// Graph-visible diagnostics are optional and must not interrupt host cleanup.
		}
	};
	const keyOf = (requestId: string, requestBindingId?: string) =>
		requestBindingId === undefined ? requestId : canonicalTupleKey([requestBindingId, requestId]);
	const rejectEntry = (
		entry: NestHttpPendingEntry<TPayload>,
		error: unknown,
		envelope: NestReplyEnvelope<TPayload> | undefined,
		message: string,
	) => {
		try {
			entry.handle.reject(error, envelope);
		} catch (rejectError) {
			report({
				kind: "reject-threw",
				requestId: entry.requestId,
				bindingId: entry.bindingId,
				message,
				error: rejectError,
			});
		}
	};
	const rejectPending = (
		kind: "dispose-pending" | "terminal-egress",
		error: unknown,
		message: string,
	): number => {
		const entries = [...pending.values()];
		pending.clear();
		if (entries.length === 0) return 0;
		report({ kind, bindingId: scopedBindingId, message, error });
		for (const entry of entries) {
			rejectEntry(entry, error, undefined, `toNestHttp(${bindingId}) pending reject threw`);
		}
		return entries.length;
	};

	const unsubscribe = egress.subscribe((msg: Message) => {
		if (!active) return;
		if (msg[0] === "ERROR" || msg[0] === "COMPLETE" || msg[0] === "TEARDOWN") {
			const error =
				msg[0] === "ERROR"
					? msg[1]
					: new Error(`toNestHttp(${bindingId}) egress received ${msg[0]}`);
			const message = `toNestHttp(${bindingId}) rejected pending requests after ${msg[0]}`;
			terminal = { error, message };
			const rejectedCount = rejectPending("terminal-egress", error, message);
			if (rejectedCount === 0)
				report({ kind: "terminal-egress", bindingId: scopedBindingId, message, error });
			return;
		}
		if (msg[0] !== "DATA") return;
		const envelope = msg[1] as NestReplyEnvelope<TPayload>;
		const malformed = validateEnvelope(envelope, maxPayloadBytes);
		if (malformed !== undefined) {
			const correlated = malformedCorrelation(msg[1], scopedBindingId);
			if (correlated !== undefined) {
				const pendingKey = keyOf(correlated.requestId, scopedBindingId);
				const entry = pending.get(pendingKey);
				if (entry !== undefined) {
					pending.delete(pendingKey);
					rejectEntry(
						entry,
						new Error(malformed),
						undefined,
						`toNestHttp(${bindingId}) rejected malformed correlated egress`,
					);
				}
			}
			report({
				kind: "malformed-egress",
				requestId: correlated?.requestId,
				bindingId: correlated?.bindingId,
				message: malformed,
			});
			return;
		}
		if (scopedBindingId !== undefined && envelope.bindingId !== scopedBindingId) {
			report({
				kind: "binding-mismatch",
				requestId: envelope.requestId,
				bindingId: envelope.bindingId,
				expectedBindingId: scopedBindingId,
				message: `toNestHttp(${bindingId}) ignored egress for binding ${envelope.bindingId}`,
			});
			return;
		}
		const pendingKey = keyOf(envelope.requestId, scopedBindingId);
		const entry = pending.get(pendingKey);
		if (entry === undefined) {
			report({
				kind: "stale-egress",
				requestId: envelope.requestId,
				bindingId: envelope.bindingId,
				message: `toNestHttp(${bindingId}) ignored stale requestId ${envelope.requestId}`,
			});
			return;
		}
		pending.delete(pendingKey);
		try {
			entry.handle.resolve(
				opts.transform?.(envelope.payload, envelope) ?? envelope.payload,
				envelope,
			);
		} catch (error) {
			report({
				kind: "resolve-threw",
				requestId: envelope.requestId,
				bindingId: envelope.bindingId,
				message: `toNestHttp(${bindingId}) response handle threw while resolving`,
				error,
			});
			rejectEntry(
				entry,
				error,
				envelope,
				`toNestHttp(${bindingId}) response handle threw while rejecting`,
			);
		}
	});

	return {
		kind: "http",
		bindingId,
		attach(registration) {
			if (!active) throw new Error(`toNestHttp(${bindingId}) is disposed`);
			assertNonEmptyString(registration.requestId, "toNestHttp.attach(requestId)");
			const registrationBindingId = registration.bindingId ?? scopedBindingId;
			if (scopedBindingId !== undefined && registrationBindingId !== scopedBindingId) {
				throw new Error(
					`toNestHttp.attach expected bindingId ${scopedBindingId}, got ${registrationBindingId}`,
				);
			}
			if (terminal !== undefined) {
				const entry = {
					requestId: registration.requestId,
					bindingId: registrationBindingId,
					handle: registration.handle,
				};
				report({
					kind: "terminal-egress",
					requestId: registration.requestId,
					bindingId: registrationBindingId,
					message: terminal.message,
					error: terminal.error,
				});
				rejectEntry(
					entry,
					terminal.error,
					undefined,
					`toNestHttp(${bindingId}) terminal response handle reject threw`,
				);
				return () => false;
			}
			const key = keyOf(registration.requestId, scopedBindingId);
			if (pending.has(key)) {
				throw new Error(`toNestHttp.attach duplicate pending requestId ${registration.requestId}`);
			}
			const entry = {
				requestId: registration.requestId,
				bindingId: registrationBindingId,
				handle: registration.handle,
			};
			pending.set(key, entry);
			return () => {
				if (pending.get(key) !== entry) return false;
				return pending.delete(key);
			};
		},
		pendingCount: () => pending.size,
		diagnostics: () => diagnostics.slice(),
		dispose() {
			if (!active) return;
			active = false;
			rejectPending(
				"dispose-pending",
				new Error(`toNestHttp(${bindingId}) disposed before response resolution`),
				`toNestHttp(${bindingId}) rejected pending requests during dispose`,
			);
			unsubscribe();
		},
	};
}

/** D478 route-request decorator over an existing ingress boundary. */
export function GraphReq<THost = unknown, TPayload = unknown>(
	boundary: NestIngressBoundary<THost, TPayload>,
	opts: NestBoundaryDecoratorOptions<THost, TPayload> = {},
): GraphMethodDecorator {
	return graphIngressBinding("request", boundary, opts);
}

/** D478 route-guard decorator over an existing ingress boundary. */
export function GraphGuard<THost = unknown, TPayload = unknown>(
	boundary: NestIngressBoundary<THost, TPayload>,
	opts: NestBoundaryDecoratorOptions<THost, TPayload> = {},
): GraphMethodDecorator {
	return graphIngressBinding("guard", boundary, opts);
}

/** D478 route-interceptor decorator over an existing ingress boundary. */
export function GraphIntercept<THost = unknown, TPayload = unknown>(
	boundary: NestIngressBoundary<THost, TPayload>,
	opts: NestBoundaryDecoratorOptions<THost, TPayload> = {},
): GraphMethodDecorator {
	return graphIngressBinding("interceptor", boundary, opts);
}

/** D484 generic filter decorator over an existing ingress boundary. */
export function GraphFilter<THost = unknown, TPayload = unknown>(
	boundary: NestIngressBoundary<THost, TPayload>,
	opts: NestFilterDecoratorOptions<THost, TPayload> = {},
): GraphMethodDecorator {
	return graphIngressBinding("error", boundary, opts);
}

/** D484 exception-oriented sugar over GraphFilter. */
export function GraphError<THost = unknown, TPayload = unknown>(
	boundary: NestIngressBoundary<THost, TPayload>,
	opts: NestFilterDecoratorOptions<THost, TPayload> = {},
): GraphMethodDecorator {
	return GraphFilter(boundary, opts);
}

/** D478 lifecycle decorator over an existing ingress boundary. */
export function GraphLifecycle<THost = unknown, TPayload = unknown>(
	boundary: NestIngressBoundary<THost, TPayload>,
	opts: NestBoundaryDecoratorOptions<THost, TPayload> = {},
): GraphMethodDecorator {
	return graphIngressBinding("lifecycle", boundary, opts);
}

/** D478 cron/schedule decorator over an existing ingress boundary. */
export function GraphCron<THost = unknown, TPayload = unknown>(
	boundary: NestIngressBoundary<THost, TPayload>,
	opts: NestBoundaryDecoratorOptions<THost, TPayload> = {},
): GraphMethodDecorator {
	return graphIngressBinding("cron", boundary, opts);
}

/** D488 WebSocket message ingress decorator over an existing boundary. */
export function GraphWs<THost = unknown, TPayload = unknown>(
	boundary: NestIngressBoundary<THost, TPayload>,
	opts: NestBoundaryDecoratorOptions<THost, TPayload> = {},
): GraphMethodDecorator {
	return graphIngressBinding("ws", boundary, opts);
}

/** D488 microservice/message ingress decorator over an existing boundary. */
export function GraphMessage<THost = unknown, TPayload = unknown>(
	boundary: NestIngressBoundary<THost, TPayload>,
	opts: NestBoundaryDecoratorOptions<THost, TPayload> = {},
): GraphMethodDecorator {
	return graphIngressBinding("message", boundary, opts);
}

/** D478 HTTP reply decorator over an existing reply node. */
export function GraphHttpReply<THost = unknown, TPayload = unknown>(
	replyNode: Node<NestReplyEnvelope<TPayload>>,
	opts: NestHttpReplyDecoratorOptions<THost>,
): GraphMethodDecorator {
	const bindingId = opts?.bindingId;
	if (typeof bindingId !== "string" || bindingId.length === 0) {
		throw new Error("GraphHttpReply requires a non-empty bindingId");
	}
	return registerMeta(NEST_BOUNDARY_BINDINGS, (methodKey) => ({
		direction: "egress" as const,
		kind: "http" as const,
		bindingId,
		methodKey,
		replyNode: replyNode as Node<NestReplyEnvelope<unknown>>,
		order: opts.order,
		issueResponse: opts.issueResponse as NestIssueResponse<unknown> | undefined,
		protocolError: opts.protocolError as NestProtocolErrorResponse<unknown> | undefined,
	}));
}

/** D484 guard decision egress decorator over an existing reply-correlated decision node. */
export function GraphGuardDecision<THost = unknown>(
	decisionNode: Node<NestReplyEnvelope<GraphGuardDecision>>,
	opts: NestGuardDecisionDecoratorOptions<THost>,
): GraphMethodDecorator {
	const bindingId = opts?.bindingId;
	if (typeof bindingId !== "string" || bindingId.length === 0) {
		throw new Error("GraphGuardDecision requires a non-empty bindingId");
	}
	return registerMeta(NEST_BOUNDARY_BINDINGS, (methodKey) => ({
		direction: "egress" as const,
		kind: "guard-decision" as const,
		bindingId,
		methodKey,
		decisionNode,
		order: opts.order,
		issueResponse: opts.issueResponse as NestIssueResponse<unknown> | undefined,
		protocolError: opts.protocolError as NestProtocolErrorResponse<unknown> | undefined,
	}));
}

/** D488 WebSocket acknowledgement egress decorator over an existing reply-correlated node. */
export function GraphWsAck<TPayload = unknown>(
	ackNode: Node<NestReplyEnvelope<TPayload>>,
	opts: { readonly bindingId: string; readonly order?: number },
): GraphMethodDecorator {
	return graphReplyBinding("ws-ack", ackNode, opts, "GraphWsAck");
}

/** D488 WebSocket reply egress decorator over an existing reply-correlated node. */
export function GraphWsReply<TPayload = unknown>(
	replyNode: Node<NestReplyEnvelope<TPayload>>,
	opts: { readonly bindingId: string; readonly order?: number },
): GraphMethodDecorator {
	return graphReplyBinding("ws-reply", replyNode, opts, "GraphWsReply");
}

/** D488 microservice/message reply egress decorator over an existing reply-correlated node. */
export function GraphMessageReply<TPayload = unknown>(
	replyNode: Node<NestReplyEnvelope<TPayload>>,
	opts: { readonly bindingId: string; readonly order?: number },
): GraphMethodDecorator {
	return graphReplyBinding("message-reply", replyNode, opts, "GraphMessageReply");
}

/**
 * Creates a nest graph boundary runner.
 *
 * @param opts - Options that configure the helper.
 * @returns The create nest graph boundary runner result.
 * @category adapters
 * @example
 * ```ts
 * import { createNestGraphBoundaryRunner } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function createNestGraphBoundaryRunner(
	opts: NestGraphBoundaryRunnerOptions = {},
): NestGraphBoundaryRunner {
	const httpBoundaries = new Map<
		Node<NestReplyEnvelope<unknown>>,
		Map<string, NestHttpBoundary<unknown>>
	>();
	const httpBoundaryFor = (
		node: Node<NestReplyEnvelope<unknown>>,
		bindingId: string,
	): NestHttpBoundary<unknown> => {
		let byBinding = httpBoundaries.get(node);
		if (byBinding === undefined) {
			byBinding = new Map();
			httpBoundaries.set(node, byBinding);
		}
		let boundary = byBinding.get(bindingId);
		if (boundary === undefined) {
			boundary = toNestHttp(node, {
				bindingId,
				diagnosticBoundary: opts.diagnosticBoundary,
				diagnosticPhase: opts.diagnosticPhase ?? "http",
			});
			byBinding.set(bindingId, boundary);
		}
		return boundary;
	};

	return {
		run(target, methodKey, host, opts = {}) {
			const ctor = typeof target === "function" ? target : target.constructor;
			const bindings = getNestBoundaryBindings(ctor as DecoratorHostConstructor, methodKey);
			if (bindings.length === 0) return undefined;
			const requestId = requestIdFromRunOptions(host, opts);
			const replies = bindings.filter(isHttpReplyBinding);
			const ingress = bindings.filter(
				(binding): binding is NestIngressBindingMeta =>
					binding.direction === "ingress" &&
					(binding.kind === "request" || binding.kind === "interceptor"),
			);
			if (replies.length > 0 && ingress.length === 0) {
				throw new Error("Nest GraphHttpReply requires at least one ingress boundary");
			}
			const ingressEmits = ingress.map((binding) => ({
				binding,
				requestId: requestIdFromBinding(host, binding) ?? requestId,
			}));
			const replyRequestIds = uniqueDefinedStrings(ingressEmits.map((entry) => entry.requestId));
			if (replies.length > 0 && replyRequestIds.length === 0) {
				throw new Error("Nest GraphHttpReply requires a stable requestId");
			}
			const cleanups: Array<() => boolean> = [];
			let resolveReply: ((value: unknown) => void) | undefined;
			let rejectReply: ((reason?: unknown) => void) | undefined;
			const replyPromise =
				replies.length === 0
					? undefined
					: new Promise<unknown>((resolve, reject) => {
							resolveReply = resolve;
							rejectReply = reject;
						});
			try {
				for (const reply of replies) {
					const http = httpBoundaryFor(reply.replyNode, reply.bindingId);
					for (const replyRequestId of replyRequestIds) {
						cleanups.push(
							http.attach({
								requestId: replyRequestId,
								bindingId: reply.bindingId,
								handle: {
									resolve: resolveReply ?? (() => undefined),
									reject: rejectReply ?? (() => undefined),
								},
							}),
						);
					}
				}
				for (const entry of ingressEmits) {
					entry.binding.boundary.emit(host, {
						bindingId: entry.binding.bindingId,
						requestId: entry.requestId,
						...bindingPayloadEmitOption(host, entry.binding),
						requireRequestId: requiresRequestId(entry.binding.kind),
					});
				}
			} catch (error) {
				for (const cleanup of cleanups) cleanup();
				throw error;
			}
			return replyPromise?.finally(() => {
				for (const cleanup of cleanups) cleanup();
			});
		},
		dispose() {
			for (const byBinding of httpBoundaries.values()) {
				for (const boundary of byBinding.values()) boundary.dispose();
			}
			httpBoundaries.clear();
		},
	};
}

/**
 * Creates a nest graph boundary interceptor.
 *
 * @param opts - Options that configure the helper.
 * @returns The create nest graph boundary interceptor result.
 * @category adapters
 * @example
 * ```ts
 * import { createNestGraphBoundaryInterceptor } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function createNestGraphBoundaryInterceptor<THost = unknown>(
	opts: NestGraphBoundaryInterceptorOptions<THost> = {},
): NestGraphBoundaryInterceptor {
	const runner = opts.runner ?? createNestGraphBoundaryRunner(opts);
	let nextRequestSeq = 1;
	return {
		intercept(context, next) {
			const ctor = context.getClass();
			const handler = context.getHandler();
			const methodKey = methodKeyForHandler(ctor, handler);
			if (methodKey === undefined) return next?.handle();
			const bindings = getNestBoundaryBindings(ctor, methodKey);
			const needsSyntheticRequestId = bindings.some(
				(binding) =>
					binding.direction === "egress" ||
					(binding.direction === "ingress" && requiresRequestId(binding.kind)),
			);
			const host =
				opts.host?.(context) ??
				(defaultNestHttpHost(context, () => nextRequestSeq++, needsSyntheticRequestId) as THost) ??
				({} as THost);
			const result = runner.run(ctor, methodKey, host, opts);
			return result ?? next?.handle();
		},
		dispose() {
			runner.dispose();
		},
	};
}

/**
 * Creates a get nest boundary bindings.
 *
 * @param target - Class or instance that owns the decorated method.
 * @param methodKey - Method key on the decorated target.
 * @returns The get nest boundary bindings result.
 * @category adapters
 * @example
 * ```ts
 * import { getNestBoundaryBindings } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function getNestBoundaryBindings(
	target: DecoratorHostConstructor | object,
	methodKey?: string | symbol,
): readonly NestBoundaryBindingMeta[] {
	const ctor =
		typeof target === "function"
			? (target as DecoratorHostConstructor)
			: ((target as { constructor: DecoratorHostConstructor })
					.constructor as DecoratorHostConstructor);
	const bindings = boundaryBindingsFor(ctor);
	return sortBoundaryBindings(
		methodKey === undefined
			? bindings
			: bindings.filter((binding) => binding.methodKey === methodKey),
	);
}

/**
 * Resolves nest method key.
 *
 * @param ctor - Constructor that may own the decorated handler.
 * @param handler - Handler function to match against metadata.
 * @returns The stable key or reference string.
 * @category adapters
 * @example
 * ```ts
 * import { resolveNestMethodKey } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function resolveNestMethodKey(
	ctor: DecoratorHostConstructor,
	handler: DecoratorBoundMethod,
): string | symbol | undefined {
	return methodKeyForHandler(ctor, handler);
}

/**
 * Creates a binding request ID.
 *
 * @param host - Host object from the framework boundary.
 * @param binding - Nest boundary binding metadata.
 * @param fallback - fallback value used by the helper.
 * @returns The binding request ID result.
 * @category adapters
 * @example
 * ```ts
 * import { bindingRequestId } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function bindingRequestId<THost>(
	host: THost,
	binding: NestBoundaryBindingMeta,
	fallback?: string | ((host: THost) => string | undefined),
): string | undefined {
	if (binding.direction === "ingress") {
		const requestId = requestIdFromBinding(host, binding);
		if (requestId !== undefined) return requestId;
	}
	if (typeof fallback === "string") {
		assertNonEmptyString(fallback, "requestId");
		return fallback;
	}
	if (typeof fallback === "function") {
		const requestId = fallback(host);
		if (requestId !== undefined) assertNonEmptyString(requestId, "requestId");
		return requestId;
	}
	return requestIdOf(host, {}, {});
}

/**
 * Creates a binding emit options.
 *
 * @param host - Host object from the framework boundary.
 * @param binding - Nest boundary binding metadata.
 * @param requestId - Host request correlation id.
 * @returns The binding emit options result.
 * @category adapters
 * @example
 * ```ts
 * import { bindingEmitOptions } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function bindingEmitOptions<THost>(
	host: THost,
	binding: NestIngressBindingMeta,
	requestId?: string,
): NestIngressEmitOptions<unknown> {
	return {
		bindingId: binding.bindingId,
		requestId,
		...bindingPayloadEmitOption(host, binding),
		requireRequestId: requiresRequestId(binding.kind),
	};
}

/**
 * Checks whether a value is a data issue.
 *
 * @param value - Unknown value to check or decode.
 * @returns `true` when the value matches the expected shape.
 * @category adapters
 * @example
 * ```ts
 * import { isDataIssue } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function isDataIssue(value: unknown): value is DataIssue {
	return (
		value !== null &&
		typeof value === "object" &&
		(value as { kind?: unknown }).kind === "issue" &&
		typeof (value as { code?: unknown }).code === "string" &&
		typeof (value as { message?: unknown }).message === "string"
	);
}

/**
 * Checks whether a value is a HTTP data issue.
 *
 * @param value - Unknown value to check or decode.
 * @returns `true` when the value matches the expected shape.
 * @category adapters
 * @example
 * ```ts
 * import { isHttpDataIssue } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function isHttpDataIssue(value: unknown): value is HttpDataIssue {
	return isDataIssue(value) && Number.isInteger((value as { status?: unknown }).status);
}

/**
 * Checks whether a value is an issue response.
 *
 * @param issue - Data issue to lower into a response.
 * @param _host - Host object from the framework boundary.
 * @returns `true` when the value matches the expected shape.
 * @category adapters
 * @example
 * ```ts
 * import { issueResponse } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function issueResponse<THost = unknown>(
	issue: DataIssue,
	_host?: THost,
): NestHttpResponsePayload {
	if (isHttpDataIssue(issue)) {
		return {
			status: issue.status,
			body: issue.body ?? { code: issue.code, message: issue.message },
			headers: issue.headers,
		};
	}
	return {
		status: 400,
		body: { code: issue.code, message: issue.message },
	};
}

/**
 * Creates a protocol error.
 *
 * @param _errorPayload - Protocol error payload to lower into a response.
 * @param _host - Host object from the framework boundary.
 * @returns The protocol error result.
 * @category adapters
 * @example
 * ```ts
 * import { protocolError } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function protocolError<THost = unknown>(
	_errorPayload: unknown,
	_host?: THost,
): NestHttpResponsePayload {
	return {
		status: 500,
		body: { code: "graphrefly.protocol_error", message: "GraphReFly reply pipeline failed" },
	};
}

/**
 * Lowers HTTP reply payload.
 *
 * @param payload - Payload to lower or wrap.
 * @param host - Host object from the framework boundary.
 * @param opts - Options that configure the helper.
 * @returns The lower HTTP reply payload result.
 * @category adapters
 * @example
 * ```ts
 * import { lowerHttpReplyPayload } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function lowerHttpReplyPayload<THost = unknown>(
	payload: unknown,
	host: THost,
	opts: { readonly issueResponse?: NestIssueResponse<THost> } = {},
): NestHttpResponsePayload {
	if (isHttpResponsePayload(payload)) return payload;
	if (isDataIssue(payload)) return (opts.issueResponse ?? issueResponse)(payload, host);
	return { status: 200, body: payload };
}

/**
 * Lowers protocol error.
 *
 * @param errorPayload - Protocol error payload to lower into a response.
 * @param host - Host object from the framework boundary.
 * @param opts - Options that configure the helper.
 * @returns The lower protocol error result.
 * @category adapters
 * @example
 * ```ts
 * import { lowerProtocolError } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function lowerProtocolError<THost = unknown>(
	errorPayload: unknown,
	host: THost,
	opts: { readonly protocolError?: NestProtocolErrorResponse<THost> } = {},
): NestHttpResponsePayload {
	return (opts.protocolError ?? protocolError)(errorPayload, host);
}

/**
 * Sanitizes nest diagnostic.
 *
 * @param diagnostic - Diagnostic input to sanitize.
 * @param defaultPhase - Phase to use when the diagnostic does not provide one.
 * @returns The sanitize nest diagnostic result.
 * @category adapters
 * @example
 * ```ts
 * import { sanitizeNestDiagnostic } from "@graphrefly/ts/adapters/nestjs";
 * ```
 */
export function sanitizeNestDiagnostic(
	diagnostic: NestDiagnosticInput,
	defaultPhase: NestDiagnosticPhase = "adapter",
): NestDiagnosticPayload {
	const payload: NestDiagnosticPayload = {
		kind: diagnostic.kind,
		phase: diagnostic.phase ?? defaultPhase,
		message: diagnostic.message,
		...optionalStringField("requestId", diagnostic.requestId),
		...optionalStringField("bindingId", diagnostic.bindingId),
		...optionalStringField("expectedBindingId", diagnostic.expectedBindingId),
		...optionalDiagnosticError(diagnostic.error),
	};
	assertGraphVisibleData(payload, "NestDiagnosticPayload", NEST_BOUNDARY_PAYLOAD_MAX_BYTES);
	return payload;
}

function nestIngress<THost, TPayload>(
	graph: Graph,
	kind: NestBoundaryKind,
	opts: NestIngressOptions<THost, TPayload>,
): NestIngressBoundary<THost, TPayload> {
	const bindingId = stableBindingId(kind, opts);
	const version = parseEnvelopeVersion(opts.version ?? NEST_BOUNDARY_ENVELOPE_VERSION, "version");
	const maxPayloadBytes = payloadByteLimit(opts.maxPayloadBytes);
	const node = graph.node<NestBoundaryEnvelope<TPayload>>([], null, {
		name: opts.name,
		meta: { adapter: "nestjs", boundary: "ingress", kind, bindingId, version },
	});

	return {
		kind,
		bindingId,
		version,
		node,
		envelope(host, emitOpts = {}) {
			const requestId = requestIdOf(host, opts, {
				...emitOpts,
				requireRequestId:
					emitOpts.requireRequestId ?? opts.requireRequestId ?? requiresRequestId(kind),
			});
			const envelopeBindingId = emitOpts.bindingId ?? bindingId;
			assertNonEmptyString(envelopeBindingId, "NestBoundaryEnvelope.bindingId");
			const envelopeVersion = parseEnvelopeVersion(
				emitOpts.version ?? version,
				"NestBoundaryEnvelope.version",
			);
			const payload =
				"payload" in emitOpts
					? (emitOpts.payload as TPayload)
					: opts.payload !== undefined
						? opts.payload(host)
						: (host as unknown as TPayload);
			assertGraphVisibleData(payload, "NestBoundaryEnvelope.payload", maxPayloadBytes);
			const envelope: NestBoundaryEnvelope<TPayload> = {
				bindingId: envelopeBindingId,
				version: envelopeVersion,
				payload,
			};
			return requestId === undefined ? envelope : { ...envelope, requestId };
		},
		emit(host, emitOpts = {}) {
			const envelope = this.envelope(host, emitOpts);
			node.down([["DATA", envelope]]);
			return envelope;
		},
	};
}

function stableBindingId(
	kind: NestBoundaryKind | NestEgressKind,
	opts: { readonly bindingId?: string; readonly name?: string },
): string {
	const bindingId = opts.bindingId ?? opts.name ?? `nestjs.${kind}`;
	assertNonEmptyString(bindingId, "bindingId");
	return bindingId;
}

function requiresRequestId(kind: NestBoundaryKind): boolean {
	return kind === "request" || kind === "guard" || kind === "interceptor" || kind === "error";
}

function requestIdFromRunOptions<THost>(
	host: THost,
	opts: NestGraphRunOptions<THost>,
): string | undefined {
	if (typeof opts.requestId === "string") {
		assertNonEmptyString(opts.requestId, "requestId");
		return opts.requestId;
	}
	if (typeof opts.requestId === "function") {
		const requestId = opts.requestId(host);
		if (requestId !== undefined) assertNonEmptyString(requestId, "requestId");
		return requestId;
	}
	return requestIdOf(host, {}, {});
}

function requestIdFromBinding<THost>(
	host: THost,
	binding: NestIngressBindingMeta,
): string | undefined {
	if (typeof binding.requestId === "string") {
		assertNonEmptyString(binding.requestId, "requestId");
		return binding.requestId;
	}
	if (typeof binding.requestId === "function") {
		const requestId = binding.requestId(host);
		if (requestId !== undefined) assertNonEmptyString(requestId, "requestId");
		return requestId;
	}
	return undefined;
}

function bindingPayloadEmitOption<THost>(
	host: THost,
	binding: NestIngressBindingMeta,
): { readonly payload: unknown } | Record<string, never> {
	return binding.payload === undefined ? {} : { payload: binding.payload(host) };
}

function isHttpResponsePayload(value: unknown): value is NestHttpResponsePayload {
	if (value === null || typeof value !== "object") return false;
	const status = (value as { status?: unknown }).status;
	if (!Number.isInteger(status)) return false;
	const headers = (value as { headers?: unknown }).headers;
	return headers === undefined || isStringRecord(headers);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	for (const entry of Object.values(value)) if (typeof entry !== "string") return false;
	return true;
}

function isHttpReplyBinding(binding: NestBoundaryBindingMeta): binding is NestHttpReplyBindingMeta {
	return binding.direction === "egress" && binding.kind === "http";
}

function uniqueDefinedStrings(values: readonly (string | undefined)[]): string[] {
	const seen = new Set<string>();
	for (const value of values) {
		if (value !== undefined) seen.add(value);
	}
	return [...seen];
}

function defaultNestHttpHost(
	context: NestExecutionContextLike,
	nextSeq: () => number,
	needsSyntheticRequestId: boolean,
): unknown | undefined {
	const request = context.switchToHttp?.().getRequest<Record<string, unknown>>();
	if (request === undefined || request === null || typeof request !== "object") return request;
	if (requestIdFromRecord(request) !== undefined) return request;
	const headerId = requestIdFromHeaders(request.headers);
	if (headerId !== undefined || needsSyntheticRequestId) {
		return { ...request, requestId: headerId ?? `nestjs-request:${nextSeq()}` };
	}
	return request;
}

function requestIdFromRecord(record: Record<string, unknown>): string | undefined {
	for (const key of ["requestId", "id"]) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

function requestIdFromHeaders(headers: unknown): string | undefined {
	if (headers === null || typeof headers !== "object") return undefined;
	for (const key of ["x-request-id", "x-correlation-id"]) {
		const value = (headers as Record<string, unknown>)[key];
		const first = Array.isArray(value) ? value[0] : value;
		if (typeof first === "string" && first.trim().length > 0) return first.trim();
	}
	return undefined;
}

function graphIngressBinding<THost, TPayload>(
	kind: NestBoundaryKind,
	boundary: NestIngressBoundary<THost, TPayload>,
	opts: NestBoundaryDecoratorOptions<THost, TPayload> & NestFilterDecoratorOptions<THost, TPayload>,
): GraphMethodDecorator {
	if (boundary.kind !== kind) {
		throw new Error(`Graph${kind} expected a ${kind} boundary, got ${boundary.kind}`);
	}
	const bindingId = opts.bindingId ?? boundary.bindingId;
	assertNonEmptyString(bindingId, "bindingId");
	return registerMeta(NEST_BOUNDARY_BINDINGS, (methodKey) => ({
		direction: "ingress" as const,
		kind,
		bindingId,
		methodKey,
		boundary: boundary as NestIngressBoundary<unknown, unknown>,
		payload: opts.payload as ((host: unknown) => unknown) | undefined,
		requestId: opts.requestId as string | ((host: unknown) => string | undefined) | undefined,
		order: opts.order,
		mode: opts.mode,
		issueResponse: opts.issueResponse as NestIssueResponse<unknown> | undefined,
		protocolError: opts.protocolError as NestProtocolErrorResponse<unknown> | undefined,
	}));
}

function graphReplyBinding<TPayload>(
	kind: "ws-ack" | "ws-reply" | "message-reply",
	node: Node<NestReplyEnvelope<TPayload>>,
	opts: { readonly bindingId: string; readonly order?: number },
	decoratorName: string,
): GraphMethodDecorator {
	const bindingId = opts?.bindingId;
	if (typeof bindingId !== "string" || bindingId.length === 0) {
		throw new Error(`${decoratorName} requires a non-empty bindingId`);
	}
	const replyNode = node as Node<NestReplyEnvelope<unknown>>;
	return registerMeta(NEST_BOUNDARY_BINDINGS, (methodKey) => {
		if (kind === "ws-ack") {
			return {
				direction: "egress" as const,
				kind,
				bindingId,
				methodKey,
				ackNode: replyNode,
				order: opts.order,
			};
		}
		return {
			direction: "egress" as const,
			kind,
			bindingId,
			methodKey,
			replyNode,
			order: opts.order,
		};
	});
}

function methodKeyForHandler(
	ctor: DecoratorHostConstructor,
	handler: DecoratorBoundMethod,
): string | symbol | undefined {
	for (const binding of boundaryBindingsFor(ctor)) {
		const candidate = methodOnPrototypeChain(ctor, binding.methodKey);
		if (candidate === handler || String(binding.methodKey) === handler.name)
			return binding.methodKey;
	}
	return undefined;
}

function boundaryBindingsFor(ctor: DecoratorHostConstructor): NestBoundaryBindingMeta[] {
	const bindings: NestBoundaryBindingMeta[] = [];
	const seen = new Set<NestBoundaryBindingMeta>();
	let current: unknown = ctor;
	while (typeof current === "function" && current !== Function.prototype) {
		for (const binding of NEST_BOUNDARY_BINDINGS.get(current as DecoratorHostConstructor) ?? []) {
			if (seen.has(binding)) continue;
			seen.add(binding);
			bindings.push(binding);
		}
		current = Object.getPrototypeOf(current);
	}
	return bindings;
}

function sortBoundaryBindings(
	bindings: readonly NestBoundaryBindingMeta[],
): readonly NestBoundaryBindingMeta[] {
	return bindings
		.map((binding, index) => ({ binding, index }))
		.sort((a, b) => (a.binding.order ?? 0) - (b.binding.order ?? 0) || a.index - b.index)
		.map(({ binding }) => binding);
}

function methodOnPrototypeChain(
	ctor: DecoratorHostConstructor,
	methodKey: string | symbol,
): unknown {
	let proto: unknown = ctor.prototype;
	while (proto !== null && typeof proto === "object") {
		if (Object.hasOwn(proto, methodKey)) {
			return (proto as Record<string | symbol, unknown>)[methodKey];
		}
		proto = Object.getPrototypeOf(proto);
	}
	return undefined;
}

function requestIdOf<THost, TPayload>(
	host: THost,
	opts: NestIngressOptions<THost, TPayload>,
	emitOpts: NestIngressEmitOptions<TPayload>,
): string | undefined {
	const fromEmit = emitOpts.requestId;
	if (fromEmit !== undefined) {
		assertNonEmptyString(fromEmit, "requestId");
		return fromEmit;
	}
	if (typeof opts.requestId === "string") {
		assertNonEmptyString(opts.requestId, "requestId");
		return opts.requestId;
	}
	if (typeof opts.requestId === "function") {
		const requestId = opts.requestId(host);
		if (requestId !== undefined) assertNonEmptyString(requestId, "requestId");
		return requestId;
	}
	const record = host as { requestId?: unknown; id?: unknown };
	if (typeof record?.requestId === "string" && record.requestId.length > 0) return record.requestId;
	if (typeof record?.id === "string" && record.id.length > 0) return record.id;
	if (emitOpts.requireRequestId ?? opts.requireRequestId ?? false) {
		throw new Error("Nest boundary ingress requires a stable requestId");
	}
	return undefined;
}

function validateEnvelope(value: unknown, maxPayloadBytes: number): string | undefined {
	try {
		assertGraphVisibleData(value, "NestBoundaryEnvelope", maxPayloadBytes);
	} catch (error) {
		return error instanceof Error ? error.message : "egress envelope must be data-only material";
	}
	if (value === null || typeof value !== "object") return "egress DATA is not an envelope object";
	const envelope = value as Partial<NestBoundaryEnvelope>;
	if (typeof envelope.requestId !== "string" || envelope.requestId.length === 0) {
		return "egress envelope requestId must be a non-empty string";
	}
	if (typeof envelope.bindingId !== "string" || envelope.bindingId.length === 0) {
		return "egress envelope bindingId must be a non-empty string";
	}
	try {
		parseEnvelopeVersion(envelope.version, "egress envelope version");
	} catch {
		return `egress envelope version must be ${NEST_BOUNDARY_ENVELOPE_VERSION}`;
	}
	return undefined;
}

function malformedCorrelation(
	value: unknown,
	scopedBindingId: string | undefined,
): { readonly requestId: string; readonly bindingId: string } | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const requestId = (value as { readonly requestId?: unknown }).requestId;
	const bindingId = (value as { readonly bindingId?: unknown }).bindingId;
	if (typeof requestId !== "string" || requestId.length === 0) return undefined;
	if (typeof bindingId !== "string" || bindingId.length === 0) return undefined;
	if (scopedBindingId !== undefined && bindingId !== scopedBindingId) return undefined;
	return { requestId, bindingId };
}

function parseEnvelopeVersion(value: unknown, label: string): number {
	if (value !== NEST_BOUNDARY_ENVELOPE_VERSION) {
		throw new Error(`${label} must be ${NEST_BOUNDARY_ENVELOPE_VERSION}`);
	}
	return value;
}

function assertNonEmptyString(value: string, label: string): void {
	if (value.length === 0) throw new Error(`${label} must be a non-empty string`);
}

function optionalStringField<K extends "requestId" | "bindingId" | "expectedBindingId">(
	key: K,
	value: string | undefined,
): Record<K, string> | Record<string, never> {
	return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function optionalDiagnosticError(
	error: unknown,
): { readonly error: NestDiagnosticErrorPayload } | Record<string, never> {
	const summarized = summarizeDiagnosticError(error);
	return summarized === undefined ? {} : { error: summarized };
}

function summarizeDiagnosticError(error: unknown): NestDiagnosticErrorPayload | undefined {
	if (error === undefined) return undefined;
	if (error instanceof Error) {
		return {
			...optionalDiagnosticName(safeDiagnosticString(() => error.name)),
			message: safeDiagnosticString(() => error.message) ?? "diagnostic error",
		};
	}
	if (typeof error === "string") return { message: error };
	if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
		return { message: String(error) };
	}
	if (typeof error === "symbol") return { message: error.description ?? "symbol" };
	if (typeof error === "function") return { message: "opaque diagnostic function" };
	if (error !== null && typeof error === "object") {
		const record = error as { readonly name?: unknown; readonly message?: unknown };
		const message = safeDiagnosticString(() => record.message);
		if (message !== undefined) {
			return {
				...optionalDiagnosticName(safeDiagnosticString(() => record.name)),
				message,
			};
		}
		return { message: "opaque diagnostic error" };
	}
	return { message: String(error) };
}

function safeDiagnosticString(read: () => unknown): string | undefined {
	try {
		const value = read();
		return typeof value === "string" ? value : undefined;
	} catch {
		return undefined;
	}
}

function optionalDiagnosticName(
	name: string | undefined,
): { readonly name: string } | Record<string, never> {
	return name === undefined || name.length === 0 ? {} : { name };
}

function payloadByteLimit(value: number | undefined): number {
	if (value === undefined) return NEST_BOUNDARY_PAYLOAD_MAX_BYTES;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error("Nest boundary maxPayloadBytes must be a positive safe integer");
	}
	return value;
}

function diagnosticsRetainedLimit(value: number | undefined): number {
	if (value === undefined) return NEST_HTTP_DIAGNOSTICS_MAX_RETAINED;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error("toNestHttp maxDiagnostics must be a non-negative safe integer");
	}
	return value;
}

function pushDiagnostic(
	diagnostics: NestBoundaryDiagnostic[],
	diagnostic: NestBoundaryDiagnostic,
	maxDiagnostics: number,
): void {
	if (maxDiagnostics === 0) return;
	diagnostics.push(diagnostic);
	if (diagnostics.length > maxDiagnostics)
		diagnostics.splice(0, diagnostics.length - maxDiagnostics);
}

function assertGraphVisibleData(
	value: unknown,
	path: string,
	maxPayloadBytes: number,
	seen = new WeakSet<object>(),
): void {
	if (value === undefined) {
		throw new TypeError(`${path} cannot be undefined; undefined is SENTINEL/no DATA`);
	}
	if (value === null) return;
	const type = typeof value;
	if (type === "string" || type === "boolean") return;
	if (type === "number") {
		if (!Number.isFinite(value)) throw new TypeError(`${path} number must be finite`);
		return;
	}
	if (type === "function" || type === "symbol" || type === "bigint") {
		throw new TypeError(`${path} must be data-only; found ${type}`);
	}
	if (type !== "object") return;
	if (seen.has(value as object)) throw new TypeError(`${path} must be acyclic data`);
	seen.add(value as object);
	if (Array.isArray(value)) {
		try {
			for (let i = 0; i < value.length; i += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(value, i);
				if (descriptor === undefined) {
					throw new TypeError(`${path}[${i}] cannot be a sparse array hole`);
				}
				if (!descriptor.enumerable || !("value" in descriptor)) {
					throw new TypeError(`${path}[${i}] must be enumerable plain data`);
				}
				assertGraphVisibleData(descriptor.value, `${path}[${i}]`, maxPayloadBytes, seen);
			}
			for (const key of Reflect.ownKeys(value)) {
				if (key === "length") continue;
				if (typeof key === "symbol" || !/^(0|[1-9]\d*)$/.test(key)) {
					throw new TypeError(`${path} arrays must not carry hidden or extra properties`);
				}
			}
			assertPayloadSize(value, path, maxPayloadBytes);
		} finally {
			seen.delete(value as object);
		}
		return;
	}
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) {
		throw new TypeError(`${path} must be a plain data object or array`);
	}
	try {
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key === "symbol") throw new TypeError(`${path} must not carry symbol keys`);
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor === undefined) continue;
			if (!descriptor.enumerable || !("value" in descriptor)) {
				throw new TypeError(`${path}.${key} must be enumerable plain data`);
			}
			assertGraphVisibleData(descriptor.value, `${path}.${key}`, maxPayloadBytes, seen);
		}
		assertPayloadSize(value, path, maxPayloadBytes);
	} finally {
		seen.delete(value as object);
	}
}

function assertPayloadSize(value: unknown, path: string, maxPayloadBytes: number): void {
	const serialized = JSON.stringify(value);
	if (serialized !== undefined && utf8ByteLength(serialized) > maxPayloadBytes) {
		throw new TypeError(`${path} exceeds ${maxPayloadBytes} bytes`);
	}
}

function utf8ByteLength(value: string): number {
	let bytes = 0;
	for (let i = 0; i < value.length; i += 1) {
		const code = value.charCodeAt(i);
		if (code < 0x80) {
			bytes += 1;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
			const next = value.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				i += 1;
			} else {
				bytes += 3;
			}
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

function sameMeta<T>(a: T, b: T): boolean {
	const left = a as Record<string | symbol, unknown>;
	const right = b as Record<string | symbol, unknown>;
	const keys = Reflect.ownKeys(left);
	if (keys.length !== Reflect.ownKeys(right).length) return false;
	for (const key of keys) {
		if (!Object.is(left[key], right[key])) return false;
	}
	return true;
}

function pushUniqueMeta<T>(
	registry: WeakMap<DecoratorHostConstructor, T[]>,
	ctor: DecoratorHostConstructor,
	item: T,
): void {
	const existing = registry.get(ctor) ?? [];
	if (existing.some((current) => sameMeta(current, item))) return;
	registry.set(ctor, [...existing, item]);
}

function registerMeta<T>(
	registry: WeakMap<DecoratorHostConstructor, T[]>,
	meta: (methodKey: string | symbol) => T,
): GraphMethodDecorator {
	return ((targetOrValue: object, contextOrKey: ClassMethodDecoratorContext | string | symbol) => {
		if (typeof contextOrKey === "object" && contextOrKey !== null) {
			const methodKey = contextOrKey.name;
			contextOrKey.addInitializer(function (this: unknown) {
				const ctor = (this as { constructor: DecoratorHostConstructor }).constructor;
				pushUniqueMeta(registry, ctor, meta(methodKey));
			});
			return;
		}

		const ctor = (targetOrValue as { constructor: DecoratorHostConstructor }).constructor;
		pushUniqueMeta(registry, ctor, meta(contextOrKey));
	}) as GraphMethodDecorator;
}

/** Register a method as a DATA-event handler for a graph observe path. */
export function OnGraphEvent(nodeName: string): GraphMethodDecorator {
	return registerMeta(EVENT_HANDLERS, (methodKey) => ({ nodeName, methodKey }));
}

/** Register fixed-interval metadata for a user-land NestJS scheduler bridge. */
export function GraphInterval(ms: number): GraphMethodDecorator {
	return registerMeta(INTERVAL_HANDLERS, (methodKey) => ({ ms, methodKey }));
}
