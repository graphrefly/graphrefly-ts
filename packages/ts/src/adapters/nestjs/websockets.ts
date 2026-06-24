/**
 * NestJS WebSocket native phase bridge (D488).
 *
 * This focused subpath may import `@nestjs/websockets`; the dependency-light
 * structural layer and HTTP native bridge stay free of that optional peer.
 */

import type { OnGatewayDisconnect } from "@nestjs/websockets";
import {
	bindingEmitOptions,
	bindingRequestId,
	type DecoratorHostConstructor,
	fromNestWs,
	GraphWs,
	GraphWsAck,
	GraphWsReply,
	getNestBoundaryBindings,
	type NestBoundaryBindingMeta,
	type NestBoundaryDiagnostic,
	type NestBoundaryEnvelope,
	type NestGraphRunOptions,
	type NestIngressBindingMeta,
	type NestIngressBoundary,
	type NestIngressEmitOptions,
	type NestIngressOptions,
	type NestProviderBinding,
	type NestReplyEnvelope,
	type NestReplyResponseHandle,
	type NestWsAckBindingMeta,
	type NestWsReplyBindingMeta,
	toNestHttp,
} from "../nestjs.js";

/** D488 provider token for the focused Nest WebSocket native bridge. */
export const GRAPHREFLY_NEST_WS_BRIDGE = Symbol.for("graphrefly:nest:ws-bridge");

/** Options for the D488 Nest WebSocket bridge; socket and ack handles stay host-private. */
export interface GraphWsBridgeOptions<THost = unknown> extends NestGraphRunOptions<THost> {
	readonly ack?: (host: THost) => (payload: unknown, envelope: NestReplyEnvelope<unknown>) => void;
	readonly client?: (host: THost) => object | undefined;
	readonly timeoutMs?: number;
	readonly maxDiagnostics?: number;
}

/** Explicit Nest WebSocket phase bridge over `GraphWs`, `GraphWsAck`, and `GraphWsReply` metadata. */
export interface GraphWsBridge<THost = unknown> extends OnGatewayDisconnect {
	handleMessage(
		target: DecoratorHostConstructor | object,
		methodKey: string | symbol,
		host: THost,
		opts?: NestGraphRunOptions<THost>,
	): Promise<unknown> | undefined;
	onModuleDestroy(): void;
	diagnostics(): readonly NestBoundaryDiagnostic[];
	dispose(): void;
}

type WsEgressBinding = NestWsAckBindingMeta | NestWsReplyBindingMeta;
type WsBoundary = ReturnType<typeof toNestHttp<unknown>>;
interface WsPending {
	readonly requestId: string;
	readonly cleanups: Array<() => boolean>;
	readonly reject: (error: unknown) => void;
	timeout?: ReturnType<typeof setTimeout>;
	settled: boolean;
}

/** Build a dependency-light Nest provider for the focused WebSocket bridge token. */
export function provideGraphWsBridge<THost = unknown>(
	opts: GraphWsBridgeOptions<THost> = {},
): NestProviderBinding<GraphWsBridge<THost>> {
	return { provide: GRAPHREFLY_NEST_WS_BRIDGE, useValue: createGraphWsBridge(opts) };
}

/** Create a host-private WebSocket bridge instance without scanning the Nest container. */
export function createGraphWsBridge<THost = unknown>(
	opts: GraphWsBridgeOptions<THost> = {},
): GraphWsBridge<THost> {
	return new GraphWsBridgeImpl(opts);
}

class GraphWsBridgeImpl<THost> implements GraphWsBridge<THost> {
	private readonly boundaries = new WeakMap<object, Map<string, WsBoundary>>();
	private readonly disposable = new Set<WsBoundary>();
	private readonly pendingByClient = new WeakMap<object, Set<WsPending>>();
	private readonly localDiagnostics: NestBoundaryDiagnostic[] = [];
	private active = true;

	constructor(private readonly opts: GraphWsBridgeOptions<THost>) {}

	handleDisconnect(client?: unknown): void {
		if (client === null || typeof client !== "object") return;
		const pending = this.pendingByClient.get(client);
		if (pending === undefined) return;
		for (const entry of [...pending]) {
			this.rejectPending(
				entry,
				new Error(`GraphWs native bridge disconnected before ${entry.requestId} resolved`),
				"dispose-pending",
			);
		}
		this.pendingByClient.delete(client);
	}

	onModuleDestroy(): void {
		this.dispose();
	}

	handleMessage(
		target: DecoratorHostConstructor | object,
		methodKey: string | symbol,
		host: THost,
		runOpts: NestGraphRunOptions<THost> = {},
	): Promise<unknown> | undefined {
		if (!this.active) throw new Error("GraphWs native bridge is disposed");
		const bindings = wsBindings(target, methodKey);
		const ingress = bindings.filter(isWsIngress);
		if (ingress.length === 0) return undefined;
		const egress = bindings.filter(isWsEgress);
		const needsRequestId = egress.length > 0;
		for (const binding of ingress) assertExplicitNativePayload(binding, "GraphWs");
		const ingressEmits = ingress.map((binding) => ({
			binding,
			requestId: bindingRequestId(host, binding, runOpts.requestId ?? this.opts.requestId),
		}));
		if (needsRequestId && ingressEmits.some((entry) => entry.requestId === undefined)) {
			throw new Error("GraphWs native bridge requires a stable requestId for ack/reply egress");
		}
		const requestIds = uniqueDefinedStrings(ingressEmits.map((entry) => entry.requestId));
		const cleanups: Array<() => boolean> = [];
		let settled = false;
		const replyBindings = egress.filter(isWsReply);
		const settleOnAck = replyBindings.length === 0;
		let activePending: WsPending | undefined;
		let resolvePromise: ((payload: unknown) => void) | undefined;
		let rejectPromise: ((error: unknown) => void) | undefined;
		let cleaned = false;
		const cleanupAll = () => {
			if (cleaned) return;
			cleaned = true;
			for (const cleanup of cleanups) cleanup();
			if (activePending?.timeout !== undefined) clearTimeout(activePending.timeout);
			this.unregisterClientPending(host, activePending);
		};
		const settleResolve = (payload: unknown) => {
			if (settled) return;
			settled = true;
			if (activePending !== undefined) activePending.settled = true;
			resolvePromise?.(payload);
		};
		const settleReject = (error: unknown) => {
			if (settled) return;
			settled = true;
			if (activePending !== undefined) activePending.settled = true;
			rejectPromise?.(error);
		};
		const promise =
			egress.length === 0
				? undefined
				: new Promise<unknown>((resolve, reject) => {
						resolvePromise = resolve;
						rejectPromise = reject;
					});
		if (promise !== undefined) {
			activePending = {
				requestId: requestIds[0],
				cleanups,
				reject: settleReject,
				settled: false,
			};
			try {
				for (const requestId of requestIds) {
					for (const binding of egress) {
						const boundary = this.boundaryFor(binding);
						cleanups.push(
							boundary.attach({
								requestId,
								bindingId: binding.bindingId,
								handle: this.handleFor(binding, host, settleResolve, settleReject, settleOnAck),
							}),
						);
					}
				}
			} catch (error) {
				cleanupAll();
				settleReject(error);
				return promise;
			}
			if (settled) {
				cleanupAll();
				return promise;
			}
			try {
				this.registerClientPending(host, activePending);
			} catch (error) {
				cleanupAll();
				settleReject(error);
				return promise;
			}
			if (this.opts.timeoutMs !== undefined) {
				activePending.timeout = setTimeout(() => {
					const error = new Error(`GraphWs native bridge timed out waiting for ${requestIds[0]}`);
					this.diagnose({
						kind: "timeout",
						requestId: requestIds[0],
						message: error.message,
						error,
					});
					this.rejectPending(activePending as WsPending, error, "timeout");
				}, this.opts.timeoutMs);
			}
		}
		try {
			for (const { binding, requestId } of ingressEmits) {
				binding.boundary.emit(host, {
					...bindingEmitOptions(host, binding, requestId),
					requireRequestId: needsRequestId,
				});
			}
		} catch (error) {
			cleanupAll();
			throw error;
		}
		return promise?.finally(() => {
			cleanupAll();
		});
	}

	diagnostics(): readonly NestBoundaryDiagnostic[] {
		return [
			...this.localDiagnostics,
			...[...this.disposable].flatMap((boundary) => boundary.diagnostics()),
		];
	}

	dispose(): void {
		if (!this.active) return;
		this.active = false;
		for (const boundary of this.disposable) boundary.dispose();
	}

	private boundaryFor(binding: WsEgressBinding): WsBoundary {
		const node = binding.kind === "ws-ack" ? binding.ackNode : binding.replyNode;
		let byBinding = this.boundaries.get(node);
		if (byBinding === undefined) {
			byBinding = new Map();
			this.boundaries.set(node, byBinding);
		}
		const existing = byBinding.get(binding.bindingId);
		if (existing !== undefined) return existing;
		const boundary = toNestHttp(node, {
			bindingId: binding.bindingId,
			name: `nestjs.${binding.kind}`,
			maxDiagnostics: this.opts.maxDiagnostics,
		});
		byBinding.set(binding.bindingId, boundary);
		this.disposable.add(boundary);
		return boundary;
	}

	private handleFor(
		binding: WsEgressBinding,
		host: THost,
		resolve: (payload: unknown) => void,
		reject: (error: unknown) => void,
		settleOnAck: boolean,
	): NestReplyResponseHandle<unknown> {
		return {
			resolve: (payload, envelope) => {
				if (binding.kind === "ws-ack") {
					this.opts.ack?.(host)?.(payload, envelope);
					if (settleOnAck) resolve(payload);
					return;
				}
				resolve(payload);
			},
			reject,
		};
	}

	private diagnose(diagnostic: NestBoundaryDiagnostic): void {
		this.localDiagnostics.push(diagnostic);
		if (
			this.opts.maxDiagnostics !== undefined &&
			this.localDiagnostics.length > this.opts.maxDiagnostics
		) {
			this.localDiagnostics.splice(0, this.localDiagnostics.length - this.opts.maxDiagnostics);
		}
	}

	private registerClientPending(host: THost, pending: WsPending | undefined): void {
		if (pending === undefined) return;
		const client = this.clientFor(host);
		if (client === undefined) return;
		let set = this.pendingByClient.get(client);
		if (set === undefined) {
			set = new Set();
			this.pendingByClient.set(client, set);
		}
		set.add(pending);
	}

	private unregisterClientPending(host: THost, pending: WsPending | undefined): void {
		if (pending === undefined) return;
		const client = this.clientFor(host);
		if (client === undefined) return;
		const set = this.pendingByClient.get(client);
		if (set === undefined) return;
		set.delete(pending);
		if (set.size === 0) this.pendingByClient.delete(client);
	}

	private rejectPending(
		pending: WsPending,
		error: unknown,
		kind: "dispose-pending" | "timeout",
	): void {
		if (pending.settled) return;
		pending.settled = true;
		for (const cleanup of pending.cleanups) cleanup();
		if (pending.timeout !== undefined) clearTimeout(pending.timeout);
		this.diagnose({
			kind,
			requestId: pending.requestId,
			message: error instanceof Error ? error.message : String(error),
			error,
		});
		pending.reject(error);
	}

	private clientFor(host: THost): object | undefined {
		const fromOption = this.opts.client?.(host);
		if (fromOption !== null && typeof fromOption === "object") return fromOption;
		if (host === null || typeof host !== "object") return undefined;
		const record = host as { readonly client?: unknown; readonly socket?: unknown };
		if (record.client !== null && typeof record.client === "object") return record.client;
		if (record.socket !== null && typeof record.socket === "object") return record.socket;
		return undefined;
	}
}

function wsBindings(
	target: DecoratorHostConstructor | object,
	methodKey: string | symbol,
): readonly NestBoundaryBindingMeta[] {
	return getNestBoundaryBindings(target, methodKey);
}

function isWsIngress(binding: NestBoundaryBindingMeta): binding is NestIngressBindingMeta {
	return binding.direction === "ingress" && binding.kind === "ws";
}

function isWsEgress(binding: NestBoundaryBindingMeta): binding is WsEgressBinding {
	return (
		binding.direction === "egress" && (binding.kind === "ws-ack" || binding.kind === "ws-reply")
	);
}

function isWsReply(binding: WsEgressBinding): binding is NestWsReplyBindingMeta {
	return binding.kind === "ws-reply";
}

function assertExplicitNativePayload(binding: NestIngressBindingMeta, label: string): void {
	if (binding.payload === undefined) {
		throw new Error(`${label} native bridge requires an explicit payload selector`);
	}
}

function uniqueDefinedStrings(values: readonly (string | undefined)[]): string[] {
	const seen = new Set<string>();
	for (const value of values) if (value !== undefined) seen.add(value);
	return [...seen];
}

export {
	fromNestWs,
	GraphWs,
	GraphWsAck,
	GraphWsReply,
	type NestBoundaryEnvelope,
	type NestIngressBoundary,
	type NestIngressEmitOptions,
	type NestIngressOptions,
	type NestReplyEnvelope,
};
