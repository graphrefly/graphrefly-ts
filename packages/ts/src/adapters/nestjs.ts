/**
 * Focused NestJS boundary bindings for GraphReFly (D474).
 *
 * This subpath stays dependency-light: it exposes graph boundary primitives,
 * token/provider shapes, and decorator metadata without importing Nest itself.
 * User-land Nest modules/controllers bind these helpers to real decorators and
 * host lifecycle objects at the framework edge.
 */

import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { Message } from "../protocol/messages.js";

export const NEST_BOUNDARY_ENVELOPE_VERSION = 1;
export const NEST_BOUNDARY_PAYLOAD_MAX_BYTES = 64 * 1024;
export const NEST_HTTP_DIAGNOSTICS_MAX_RETAINED = 100;

/** D474 minimal graph-visible transport envelope. Payload must be data-only. */
export interface NestBoundaryEnvelope<T = unknown> {
	readonly requestId: string;
	readonly bindingId: string;
	readonly version: number;
	readonly payload: T;
}

export type NestBoundaryKind =
	| "request"
	| "guard"
	| "interceptor"
	| "error"
	| "lifecycle"
	| "cron"
	| "ws"
	| "message";

export type NestEgressKind = "http" | "ws" | "ws-ack" | "message-reply";

export interface NestBoundaryDiagnostic {
	readonly kind:
		| "binding-mismatch"
		| "diagnostic-callback-threw"
		| "dispose-pending"
		| "malformed-egress"
		| "stale-egress"
		| "terminal-egress"
		| "resolve-threw"
		| "reject-threw";
	readonly requestId?: string;
	readonly bindingId?: string;
	readonly expectedBindingId?: string;
	readonly message: string;
	readonly error?: unknown;
}

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
	readonly requestId?: string | ((host: THost) => string);
	readonly payload?: (host: THost) => TPayload;
}

export interface NestIngressEmitOptions<TPayload> {
	readonly requestId?: string;
	readonly bindingId?: string;
	readonly version?: number;
	readonly payload?: TPayload;
}

export interface NestHttpResponseHandle<TPayload> {
	resolve(payload: TPayload, envelope: NestBoundaryEnvelope<TPayload>): void;
	reject(error: unknown, envelope?: NestBoundaryEnvelope<TPayload>): void;
}

export interface NestHttpPendingRegistration<TPayload> {
	readonly requestId: string;
	readonly handle: NestHttpResponseHandle<TPayload>;
	readonly bindingId?: string;
}

export interface NestHttpBoundary<TPayload = unknown> {
	readonly kind: "http";
	readonly bindingId: string;
	attach(registration: NestHttpPendingRegistration<TPayload>): () => boolean;
	pendingCount(): number;
	diagnostics(): readonly NestBoundaryDiagnostic[];
	dispose(): void;
}

export interface ToNestHttpOptions<TPayload> {
	readonly bindingId?: string;
	readonly maxDiagnostics?: number;
	readonly maxPayloadBytes?: number;
	readonly name?: string;
	readonly onDiagnostic?: (diagnostic: NestBoundaryDiagnostic) => void;
	readonly transform?: (payload: TPayload, envelope: NestBoundaryEnvelope<TPayload>) => TPayload;
}

interface NestHttpPendingEntry<TPayload> {
	readonly requestId: string;
	readonly bindingId?: string;
	readonly handle: NestHttpResponseHandle<TPayload>;
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

export interface NestBoundaryBindingMeta {
	kind: NestBoundaryKind | NestEgressKind;
	bindingId: string;
	methodKey: string | symbol;
}

export const EVENT_HANDLERS = new Map<DecoratorHostConstructor, OnGraphEventMeta[]>();
export const INTERVAL_HANDLERS = new Map<DecoratorHostConstructor, GraphIntervalMeta[]>();
export const CRON_HANDLERS = new Map<DecoratorHostConstructor, GraphCronMeta[]>();
export const NEST_BOUNDARY_BINDINGS = new Map<
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
	egress: Node<NestBoundaryEnvelope<TPayload>>,
	opts: ToNestHttpOptions<TPayload> = {},
): NestHttpBoundary<TPayload> {
	const bindingId = stableBindingId("http", opts);
	const scopedBindingId = opts.bindingId;
	const maxDiagnostics = diagnosticsRetainedLimit(opts.maxDiagnostics);
	const maxPayloadBytes = payloadByteLimit(opts.maxPayloadBytes);
	const pending = new Map<string, NestHttpPendingEntry<TPayload>>();
	const diagnostics: NestBoundaryDiagnostic[] = [];
	let active = true;

	const report = (diagnostic: NestBoundaryDiagnostic) => {
		pushDiagnostic(diagnostics, diagnostic, maxDiagnostics);
		try {
			opts.onDiagnostic?.(diagnostic);
		} catch (error) {
			pushDiagnostic(
				diagnostics,
				{
					kind: "diagnostic-callback-threw",
					requestId: diagnostic.requestId,
					bindingId: diagnostic.bindingId,
					expectedBindingId: diagnostic.expectedBindingId,
					message: `toNestHttp(${bindingId}) diagnostic callback threw`,
					error,
				},
				maxDiagnostics,
			);
		}
	};
	const keyOf = (requestId: string, requestBindingId?: string) =>
		requestBindingId === undefined ? requestId : `${requestBindingId}\u0000${requestId}`;
	const rejectEntry = (
		entry: NestHttpPendingEntry<TPayload>,
		error: unknown,
		envelope: NestBoundaryEnvelope<TPayload> | undefined,
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
	): void => {
		const entries = [...pending.values()];
		pending.clear();
		if (entries.length === 0) return;
		report({ kind, bindingId: scopedBindingId, message, error });
		for (const entry of entries) {
			rejectEntry(entry, error, undefined, `toNestHttp(${bindingId}) pending reject threw`);
		}
	};

	const unsubscribe = egress.subscribe((msg: Message) => {
		if (!active) return;
		if (msg[0] === "ERROR" || msg[0] === "COMPLETE" || msg[0] === "TEARDOWN") {
			const error =
				msg[0] === "ERROR"
					? msg[1]
					: new Error(`toNestHttp(${bindingId}) egress received ${msg[0]}`);
			rejectPending(
				"terminal-egress",
				error,
				`toNestHttp(${bindingId}) rejected pending requests after ${msg[0]}`,
			);
			return;
		}
		if (msg[0] !== "DATA") return;
		const envelope = msg[1] as NestBoundaryEnvelope<TPayload>;
		const malformed = validateEnvelope(envelope, maxPayloadBytes);
		if (malformed !== undefined) {
			report({
				kind: "malformed-egress",
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

function nestIngress<THost, TPayload>(
	graph: Graph,
	kind: NestBoundaryKind,
	opts: NestIngressOptions<THost, TPayload>,
): NestIngressBoundary<THost, TPayload> {
	const bindingId = stableBindingId(kind, opts);
	const version = parseEnvelopeVersion(opts.version ?? NEST_BOUNDARY_ENVELOPE_VERSION, "version");
	const maxPayloadBytes = payloadByteLimit(opts.maxPayloadBytes);
	const node = graph.node<NestBoundaryEnvelope<TPayload>>([], null, {
		name: opts.name ?? `nestjs/${kind}/${bindingId}`,
		meta: { adapter: "nestjs", boundary: "ingress", kind, bindingId, version },
	});

	return {
		kind,
		bindingId,
		version,
		node,
		envelope(host, emitOpts = {}) {
			const requestId = requestIdOf(host, opts, emitOpts);
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
			return { requestId, bindingId: envelopeBindingId, version: envelopeVersion, payload };
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

function requestIdOf<THost, TPayload>(
	host: THost,
	opts: NestIngressOptions<THost, TPayload>,
	emitOpts: NestIngressEmitOptions<TPayload>,
): string {
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
		assertNonEmptyString(requestId, "requestId");
		return requestId;
	}
	const record = host as { requestId?: unknown; id?: unknown };
	if (typeof record?.requestId === "string" && record.requestId.length > 0) return record.requestId;
	if (typeof record?.id === "string" && record.id.length > 0) return record.id;
	throw new Error("Nest boundary ingress requires a stable requestId");
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
		return "egress envelope version must be a positive safe integer";
	}
	return undefined;
}

function parseEnvelopeVersion(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive safe integer`);
	}
	return value;
}

function assertNonEmptyString(value: string, label: string): void {
	if (value.length === 0) throw new Error(`${label} must be a non-empty string`);
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
	registry: Map<DecoratorHostConstructor, T[]>,
	ctor: DecoratorHostConstructor,
	item: T,
): void {
	const existing = registry.get(ctor) ?? [];
	if (existing.some((current) => sameMeta(current, item))) return;
	registry.set(ctor, [...existing, item]);
}

function registerMeta<T>(
	registry: Map<DecoratorHostConstructor, T[]>,
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

/** Register cron metadata for a user-land NestJS scheduler bridge. */
export function GraphCron(expr: string): GraphMethodDecorator {
	return registerMeta(CRON_HANDLERS, (methodKey) => ({ expr, methodKey }));
}

/** Register a method as a host-side Nest boundary binding. */
export function NestBoundary(
	kind: NestBoundaryKind | NestEgressKind,
	bindingId: string,
): GraphMethodDecorator {
	return registerMeta(NEST_BOUNDARY_BINDINGS, (methodKey) => ({ kind, bindingId, methodKey }));
}
