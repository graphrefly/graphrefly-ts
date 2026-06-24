/**
 * NestJS microservice/message native phase bridge (D488).
 *
 * This focused subpath may import `@nestjs/microservices`; the dependency-light
 * structural layer and HTTP native bridge stay free of that optional peer.
 */

import type { CustomTransportStrategy } from "@nestjs/microservices";
import {
	bindingEmitOptions,
	bindingRequestId,
	type DecoratorHostConstructor,
	fromNestMessage,
	GraphMessage,
	GraphMessageReply,
	getNestBoundaryBindings,
	type NestBoundaryBindingMeta,
	type NestBoundaryDiagnostic,
	type NestBoundaryEnvelope,
	type NestGraphRunOptions,
	type NestIngressBindingMeta,
	type NestIngressBoundary,
	type NestIngressEmitOptions,
	type NestIngressOptions,
	type NestMessageReplyBindingMeta,
	type NestProviderBinding,
	type NestReplyEnvelope,
	type NestReplyResponseHandle,
	toNestHttp,
} from "../nestjs.js";

/** D488 provider token for the focused Nest microservice/message native bridge. */
export const GRAPHREFLY_NEST_MESSAGE_BRIDGE = Symbol.for("graphrefly:nest:message-bridge");

/** Options for the D488 Nest message bridge; transport contexts stay host-private. */
export interface GraphMessageBridgeOptions<THost = unknown> extends NestGraphRunOptions<THost> {
	readonly timeoutMs?: number;
	readonly maxDiagnostics?: number;
}

/** Explicit Nest message-pattern phase bridge over `GraphMessage` and `GraphMessageReply` metadata. */
export interface GraphMessageBridge<THost = unknown>
	extends Pick<CustomTransportStrategy, "close"> {
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

type MessageBoundary = ReturnType<typeof toNestHttp<unknown>>;

/** Build a dependency-light Nest provider for the focused message bridge token. */
export function provideGraphMessageBridge<THost = unknown>(
	opts: GraphMessageBridgeOptions<THost> = {},
): NestProviderBinding<GraphMessageBridge<THost>> {
	return { provide: GRAPHREFLY_NEST_MESSAGE_BRIDGE, useValue: createGraphMessageBridge(opts) };
}

/** Create a host-private message bridge instance without adding a router or event bus. */
export function createGraphMessageBridge<THost = unknown>(
	opts: GraphMessageBridgeOptions<THost> = {},
): GraphMessageBridge<THost> {
	return new GraphMessageBridgeImpl(opts);
}

class GraphMessageBridgeImpl<THost> implements GraphMessageBridge<THost> {
	private readonly boundaries = new WeakMap<object, Map<string, MessageBoundary>>();
	private readonly disposable = new Set<MessageBoundary>();
	private readonly localDiagnostics: NestBoundaryDiagnostic[] = [];
	private active = true;

	constructor(private readonly opts: GraphMessageBridgeOptions<THost>) {}

	close(): void {
		this.dispose();
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
		if (!this.active) throw new Error("GraphMessage native bridge is disposed");
		const bindings = getNestBoundaryBindings(target, methodKey);
		const ingress = bindings.filter(isMessageIngress);
		if (ingress.length === 0) return undefined;
		const replies = bindings.filter(isMessageReply);
		const needsRequestId = replies.length > 0;
		for (const binding of ingress) assertExplicitNativePayload(binding, "GraphMessage");
		const ingressEmits = ingress.map((binding) => ({
			binding,
			requestId: bindingRequestId(host, binding, runOpts.requestId ?? this.opts.requestId),
		}));
		if (needsRequestId && ingressEmits.some((entry) => entry.requestId === undefined)) {
			throw new Error("GraphMessage native bridge requires a stable requestId for reply egress");
		}
		const requestIds = uniqueDefinedStrings(ingressEmits.map((entry) => entry.requestId));
		const cleanups: Array<() => boolean> = [];
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let settled = false;
		let resolvePromise: ((payload: unknown) => void) | undefined;
		let rejectPromise: ((error: unknown) => void) | undefined;
		let cleaned = false;
		const cleanupAll = () => {
			if (cleaned) return;
			cleaned = true;
			for (const cleanup of cleanups) cleanup();
			this.clearTimeout(timeout);
		};
		const handle: NestReplyResponseHandle<unknown> = {
			resolve(payload) {
				if (settled) return;
				settled = true;
				resolvePromise?.(payload);
			},
			reject(error) {
				if (settled) return;
				settled = true;
				rejectPromise?.(error);
			},
		};
		const promise =
			replies.length === 0
				? undefined
				: new Promise<unknown>((resolve, reject) => {
						resolvePromise = resolve;
						rejectPromise = reject;
					});
		if (promise !== undefined) {
			try {
				for (const requestId of requestIds) {
					for (const reply of replies) {
						cleanups.push(
							this.boundaryFor(reply).attach({
								requestId,
								bindingId: reply.bindingId,
								handle,
							}),
						);
					}
				}
			} catch (error) {
				cleanupAll();
				handle.reject(error);
				return promise;
			}
			if (settled) {
				cleanupAll();
				return promise;
			}
			if (this.opts.timeoutMs !== undefined) {
				timeout = setTimeout(() => {
					cleanupAll();
					const error = new Error(
						`GraphMessage native bridge timed out waiting for ${requestIds[0]}`,
					);
					this.diagnose({
						kind: "timeout",
						requestId: requestIds[0],
						message: error.message,
						error,
					});
					handle.reject(error);
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

	private boundaryFor(binding: NestMessageReplyBindingMeta): MessageBoundary {
		let byBinding = this.boundaries.get(binding.replyNode);
		if (byBinding === undefined) {
			byBinding = new Map();
			this.boundaries.set(binding.replyNode, byBinding);
		}
		const existing = byBinding.get(binding.bindingId);
		if (existing !== undefined) return existing;
		const boundary = toNestHttp(binding.replyNode, {
			bindingId: binding.bindingId,
			name: "nestjs.message-reply",
			maxDiagnostics: this.opts.maxDiagnostics,
		});
		byBinding.set(binding.bindingId, boundary);
		this.disposable.add(boundary);
		return boundary;
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

	private clearTimeout(timeout: ReturnType<typeof setTimeout> | undefined): void {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

function isMessageIngress(binding: NestBoundaryBindingMeta): binding is NestIngressBindingMeta {
	return binding.direction === "ingress" && binding.kind === "message";
}

function isMessageReply(binding: NestBoundaryBindingMeta): binding is NestMessageReplyBindingMeta {
	return binding.direction === "egress" && binding.kind === "message-reply";
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
	fromNestMessage,
	GraphMessage,
	GraphMessageReply,
	type NestBoundaryEnvelope,
	type NestIngressBoundary,
	type NestIngressEmitOptions,
	type NestIngressOptions,
	type NestReplyEnvelope,
};
