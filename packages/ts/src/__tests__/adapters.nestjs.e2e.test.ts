import "reflect-metadata";
import type { AddressInfo } from "node:net";
import { Controller, type INestApplication, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
	type ClientProxy,
	ClientProxyFactory,
	MessagePattern,
	Transport,
} from "@nestjs/microservices";
import { WsAdapter } from "@nestjs/platform-ws";
import { SubscribeMessage, WebSocketGateway } from "@nestjs/websockets";
import { firstValueFrom } from "rxjs";
import { afterEach, describe, expect, it } from "vitest";
import {
	fromNestMessage,
	GRAPHREFLY_NEST_MESSAGE_BRIDGE,
	GraphMessage,
	type GraphMessageBridge,
	GraphMessageReply,
	provideGraphMessageProviders,
} from "../adapters/nestjs/microservices.js";
import { provideGraphBoundaryInterceptor } from "../adapters/nestjs/native.js";
import {
	fromNestWs,
	GRAPHREFLY_NEST_WS_BRIDGE,
	GraphWs,
	GraphWsAck,
	type GraphWsBridge,
	GraphWsReply,
	provideGraphWsProviders,
} from "../adapters/nestjs/websockets.js";
import {
	fromNestReq,
	GraphHttpReply,
	GraphReq,
	type NestBoundaryEnvelope,
	type NestReplyEnvelope,
} from "../adapters/nestjs.js";
import { depLatest } from "../ctx/types.js";
import { graph } from "../graph/index.js";

interface E2eHttpHost {
	readonly requestId: string;
	readonly body: { readonly orderId?: string; readonly hidden?: unknown };
	readonly headers?: Record<string, string | string[] | undefined>;
}

interface E2eWsHost {
	readonly requestId: string;
	readonly payload: { readonly orderId: string };
	readonly client: object;
	readonly ack: (payload: unknown, envelope: NestReplyEnvelope<unknown>) => void;
}

interface E2eMessageHost {
	readonly requestId: string;
	readonly payload: { readonly orderId: string };
	readonly context: object;
}

interface E2eNestHarness {
	readonly app: INestApplication;
	readonly url: string;
	readonly tcpPort: number;
	readonly wsGateway: {
		handle(
			bodyOrClient: WsMessageBody | object,
			clientOrBody: object | WsMessageBody,
			ack?: E2eWsHost["ack"],
		): unknown;
		pending(body: WsMessageBody, client: object, ack: E2eWsHost["ack"]): unknown;
		handleDisconnect(client: object): void;
	};
	readonly messageController: {
		handle(body: MessagePatternBody, context: object): unknown;
		pending(body: MessagePatternBody, context: object): unknown;
	};
	readonly wsBridge: GraphWsBridge<E2eWsHost>;
	readonly messageBridge: GraphMessageBridge<E2eMessageHost>;
	readonly httpSeen: NestBoundaryEnvelope[];
	readonly wsSeen: NestBoundaryEnvelope[];
	readonly messageSeen: NestBoundaryEnvelope[];
	readonly graphJson: () => string;
	readonly close: () => Promise<void>;
}

interface WsMessageBody {
	readonly requestId: string;
	readonly payload: { readonly orderId: string };
}

interface MessagePatternBody {
	readonly requestId: string;
	readonly payload: { readonly orderId: string };
}

const openHarnesses: E2eNestHarness[] = [];
const openClients: ClientProxy[] = [];

afterEach(async () => {
	for (const client of openClients.splice(0).reverse()) client.close();
	for (const harness of openHarnesses.splice(0).reverse()) await harness.close();
});

describe("NestJS v1 e2e wiring (D488/D489)", () => {
	it("runs HTTP, WebSocket, and message-pattern bridges without host handle DATA", async () => {
		const harness = await createE2eNestHarness();
		openHarnesses.push(harness);

		const response = await fetch(`${harness.url}/orders`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-request-id": "req-http-1",
			},
			body: JSON.stringify({ orderId: "ord-http-1", hidden: "selected-out" }),
		});
		const body = await response.json();

		expect(response.status).toBe(201);
		expect(body).toEqual({
			ok: true,
			kind: "http",
			orderId: "ord-http-1",
			requestId: "req-http-1",
		});
		expect(harness.httpSeen).toEqual([
			{
				bindingId: "http.e2e.in",
				version: 1,
				requestId: "req-http-1",
				payload: { orderId: "ord-http-1" },
			},
		]);
		expect(JSON.stringify(harness.httpSeen[0])).not.toContain("headers");
		expect(JSON.stringify(harness.httpSeen[0])).not.toContain("hidden");

		const ackCalls: unknown[] = [];
		const socket = { id: "socket-e2e" };
		const wsReply = await harness.wsGateway.handle(
			{ requestId: "req-ws-1", payload: { orderId: "ord-ws-1" } },
			socket,
			(payload, envelope) => ackCalls.push({ payload, envelope }),
		);

		expect(ackCalls).toEqual([
			{
				payload: { accepted: true, orderId: "ord-ws-1" },
				envelope: {
					bindingId: "ws.e2e.ack",
					version: 1,
					requestId: "req-ws-1",
					payload: { accepted: true, orderId: "ord-ws-1" },
				},
			},
		]);
		expect(wsReply).toEqual({ ok: true, kind: "ws", orderId: "ord-ws-1" });
		expect(harness.wsSeen).toEqual([
			{
				bindingId: "ws.e2e.in",
				version: 1,
				requestId: "req-ws-1",
				payload: { orderId: "ord-ws-1" },
			},
		]);
		expect(JSON.stringify(harness.wsSeen[0])).not.toContain("socket-e2e");
		expect(JSON.stringify(harness.wsSeen[0])).not.toContain("ack");
		expect(harness.wsBridge.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual([
			"binding-mismatch",
			"stale-egress",
		]);

		const messageReply = await harness.messageController.handle(
			{ requestId: "req-message-1", payload: { orderId: "ord-message-1" } },
			{ id: "message-context" },
		);

		expect(messageReply).toEqual({
			ok: true,
			kind: "message",
			orderId: "ord-message-1",
		});
		expect(harness.messageSeen).toEqual([
			{
				bindingId: "message.e2e.in",
				version: 1,
				requestId: "req-message-1",
				payload: { orderId: "ord-message-1" },
			},
		]);
		expect(JSON.stringify(harness.messageSeen[0])).not.toContain("message-context");
		expect(harness.messageBridge.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual([
			"binding-mismatch",
			"stale-egress",
		]);
		expect(harness.graphJson()).not.toContain("socket-e2e");
		expect(harness.graphJson()).not.toContain("message-context");

		const disconnectSocket = { id: "socket-disconnect" };
		const disconnected = harness.wsGateway.pending(
			{ requestId: "req-ws-disconnect", payload: { orderId: "ord-ws-disconnect" } },
			disconnectSocket,
			() => undefined,
		);
		harness.wsGateway.handleDisconnect(disconnectSocket);
		await expect(disconnected).rejects.toThrow(/disconnected/);
		expect(harness.wsBridge.diagnostics().map((diagnostic) => diagnostic.kind)).toContain(
			"dispose-pending",
		);

		const wsPending = harness.wsGateway.pending(
			{ requestId: "req-ws-close", payload: { orderId: "ord-ws-close" } },
			{ id: "socket-close" },
			() => undefined,
		);
		const messagePending = harness.messageController.pending(
			{ requestId: "req-message-close", payload: { orderId: "ord-message-close" } },
			{ id: "message-close-context" },
		);
		const wsPendingRejected = expect(wsPending).rejects.toThrow(/disposed/);
		const messagePendingRejected = expect(messagePending).rejects.toThrow(/disposed/);
		await harness.close();
		await wsPendingRejected;
		await messagePendingRejected;
	});

	it("accepts live WebSocket and TCP transport traffic as test-only coverage over existing APIs", async () => {
		const harness = await createE2eNestHarness();
		openHarnesses.push(harness);

		const socket = await openWebSocket(harness.url);
		try {
			const liveWsReply = nextWebSocketJson(socket);
			socket.send(
				JSON.stringify({
					event: "orders",
					data: {
						requestId: "req-ws-live",
						payload: { orderId: "ord-ws-live" },
					},
				}),
			);

			await expect(liveWsReply).resolves.toEqual({
				ok: true,
				kind: "ws",
				orderId: "ord-ws-live",
			});
		} finally {
			socket.close();
		}

		expect(harness.wsSeen).toEqual([
			{
				bindingId: "ws.e2e.in",
				version: 1,
				requestId: "req-ws-live",
				payload: { orderId: "ord-ws-live" },
			},
		]);
		expect(harness.graphJson()).not.toContain("WebSocket");
		expect(harness.graphJson()).not.toContain("readyState");

		const client = ClientProxyFactory.create({
			transport: Transport.TCP,
			options: { host: "127.0.0.1", port: harness.tcpPort },
		});
		openClients.push(client);
		await client.connect();
		const liveMessageReply = await firstValueFrom(
			client.send("orders.e2e", {
				requestId: "req-message-live",
				payload: { orderId: "ord-message-live" },
			}),
		);

		expect(liveMessageReply).toEqual({
			ok: true,
			kind: "message",
			orderId: "ord-message-live",
		});
		expect(harness.messageSeen).toEqual([
			{
				bindingId: "message.e2e.in",
				version: 1,
				requestId: "req-message-live",
				payload: { orderId: "ord-message-live" },
			},
		]);
		expect(harness.graphJson()).not.toContain("message-context");
	});
});

async function createE2eNestHarness(): Promise<E2eNestHarness> {
	const g = graph({ name: "nestjs-e2e" });
	const httpSeen: NestBoundaryEnvelope[] = [];
	const wsSeen: NestBoundaryEnvelope[] = [];
	const messageSeen: NestBoundaryEnvelope[] = [];

	const httpIn = fromNestReq<E2eHttpHost, { readonly orderId?: string }>(g, {
		bindingId: "node.http.e2e.in",
	});
	httpIn.node.subscribe((msg) => msg[0] === "DATA" && httpSeen.push(msg[1]));
	const httpReply = g.node<NestReplyEnvelope<unknown>>(
		[httpIn.node],
		(ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly orderId?: string }>;
			if (envelope.requestId === undefined) return;
			ctx.down([
				[
					"DATA",
					{
						bindingId: "http.e2e.wrong",
						version: 1,
						requestId: envelope.requestId,
						payload: { status: 599, body: { wrong: true } },
					},
				],
				[
					"DATA",
					{
						bindingId: "http.e2e.out",
						version: 1,
						requestId: envelope.requestId,
						payload: {
							status: 201,
							body: {
								ok: true,
								kind: "http",
								orderId: envelope.payload.orderId,
								requestId: envelope.requestId,
							},
						},
					},
				],
			]);
		},
		{ name: "http.e2e.out" },
	);

	const wsIn = fromNestWs<E2eWsHost, { readonly orderId: string }>(g, {
		bindingId: "node.ws.e2e.in",
	});
	wsIn.node.subscribe((msg) => msg[0] === "DATA" && wsSeen.push(msg[1]));
	const wsAck = g.node<NestReplyEnvelope<unknown>>(
		[wsIn.node],
		(ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly orderId: string }>;
			if (envelope.requestId === undefined) return;
			ctx.down([
				[
					"DATA",
					{
						bindingId: "ws.e2e.other",
						version: 1,
						requestId: envelope.requestId,
						payload: { ignored: true },
					},
				],
				[
					"DATA",
					{
						bindingId: "ws.e2e.ack",
						version: 1,
						requestId: "req-ws-stale",
						payload: { stale: true },
					},
				],
				[
					"DATA",
					{
						bindingId: "ws.e2e.ack",
						version: 1,
						requestId: envelope.requestId,
						payload: { accepted: true, orderId: envelope.payload.orderId },
					},
				],
			]);
		},
		{ name: "ws.e2e.ack" },
	);
	const wsReply = g.node<NestReplyEnvelope<unknown>>(
		[wsIn.node],
		(ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly orderId: string }>;
			if (envelope.requestId === undefined) return;
			ctx.down([
				[
					"DATA",
					{
						bindingId: "ws.e2e.reply",
						version: 1,
						requestId: envelope.requestId,
						payload: { ok: true, kind: "ws", orderId: envelope.payload.orderId },
					},
				],
			]);
		},
		{ name: "ws.e2e.reply" },
	);

	const messageIn = fromNestMessage<E2eMessageHost, { readonly orderId: string }>(g, {
		bindingId: "node.message.e2e.in",
	});
	messageIn.node.subscribe((msg) => msg[0] === "DATA" && messageSeen.push(msg[1]));
	const messageReply = g.node<NestReplyEnvelope<unknown>>(
		[messageIn.node],
		(ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly orderId: string }>;
			if (envelope.requestId === undefined) return;
			ctx.down([
				[
					"DATA",
					{
						bindingId: "message.e2e.other",
						version: 1,
						requestId: envelope.requestId,
						payload: { ignored: true },
					},
				],
				[
					"DATA",
					{
						bindingId: "message.e2e.reply",
						version: 1,
						requestId: "req-message-stale",
						payload: { stale: true },
					},
				],
				[
					"DATA",
					{
						bindingId: "message.e2e.reply",
						version: 1,
						requestId: envelope.requestId,
						payload: { ok: true, kind: "message", orderId: envelope.payload.orderId },
					},
				],
			]);
		},
		{ name: "message.e2e.reply" },
	);
	const wsPendingIn = fromNestWs<E2eWsHost, { readonly orderId: string }>(g, {
		bindingId: "node.ws.e2e.pending.in",
	});
	const wsPendingReply = g.node<NestReplyEnvelope<unknown>>([], null, {
		name: "ws.e2e.pending.reply",
	});
	const messagePendingIn = fromNestMessage<E2eMessageHost, { readonly orderId: string }>(g, {
		bindingId: "node.message.e2e.pending.in",
	});
	const messagePendingReply = g.node<NestReplyEnvelope<unknown>>([], null, {
		name: "message.e2e.pending.reply",
	});

	class E2eHttpController {
		create(): void {}
	}

	class E2eWsGateway {
		bridge?: GraphWsBridge<E2eWsHost>;

		handle(
			bodyOrClient: WsMessageBody | object,
			clientOrBody: object | WsMessageBody,
			ack: E2eWsHost["ack"] = () => undefined,
		): unknown {
			if (this.bridge === undefined) throw new Error("GraphWsBridge was not attached");
			const [client, body] = isWsMessageBody(bodyOrClient)
				? [clientOrBody as object, bodyOrClient]
				: [bodyOrClient, clientOrBody as WsMessageBody];
			return this.bridge.handleMessage(E2eWsGateway, "handle", {
				requestId: body.requestId,
				payload: body.payload,
				client,
				ack,
			});
		}

		pending(body: WsMessageBody, client: object, ack: E2eWsHost["ack"]): unknown {
			if (this.bridge === undefined) throw new Error("GraphWsBridge was not attached");
			return this.bridge.handleMessage(E2eWsGateway, "pending", {
				requestId: body.requestId,
				payload: body.payload,
				client,
				ack,
			});
		}

		handleDisconnect(client: object): void {
			if (this.bridge === undefined) throw new Error("GraphWsBridge was not attached");
			this.bridge.handleDisconnect(client);
		}
	}

	class E2eMessageController {
		bridge?: GraphMessageBridge<E2eMessageHost>;

		handle(body: MessagePatternBody, context: object): unknown {
			if (this.bridge === undefined) throw new Error("GraphMessageBridge was not attached");
			return this.bridge.handleMessage(E2eMessageController, "handle", {
				requestId: body.requestId,
				payload: body.payload,
				context,
			});
		}

		pending(body: MessagePatternBody, context: object): unknown {
			if (this.bridge === undefined) throw new Error("GraphMessageBridge was not attached");
			return this.bridge.handleMessage(E2eMessageController, "pending", {
				requestId: body.requestId,
				payload: body.payload,
				context,
			});
		}
	}

	applyClassDecorator(Controller(), E2eHttpController);
	applyMethodDecorators(
		E2eHttpController.prototype,
		"create",
		Post("orders"),
		GraphReq(httpIn, {
			bindingId: "http.e2e.in",
			requestId: (host: E2eHttpHost) => host.requestId,
			payload: (host: E2eHttpHost) => ({ orderId: host.body.orderId }),
		}),
		GraphHttpReply(httpReply, { bindingId: "http.e2e.out" }),
	);

	applyClassDecorator(WebSocketGateway(), E2eWsGateway);
	applyMethodDecorators(
		E2eWsGateway.prototype,
		"handle",
		SubscribeMessage("orders"),
		GraphWs(wsIn, {
			bindingId: "ws.e2e.in",
			requestId: (host: E2eWsHost) => host.requestId,
			payload: (host: E2eWsHost) => host.payload,
		}),
		GraphWsAck(wsAck, { bindingId: "ws.e2e.ack" }),
		GraphWsReply(wsReply, { bindingId: "ws.e2e.reply" }),
	);
	applyMethodDecorators(
		E2eWsGateway.prototype,
		"pending",
		SubscribeMessage("orders.pending"),
		GraphWs(wsPendingIn, {
			bindingId: "ws.e2e.pending.in",
			requestId: (host: E2eWsHost) => host.requestId,
			payload: (host: E2eWsHost) => host.payload,
		}),
		GraphWsReply(wsPendingReply, { bindingId: "ws.e2e.pending.reply" }),
	);

	applyClassDecorator(Controller(), E2eMessageController);
	applyMethodDecorators(
		E2eMessageController.prototype,
		"handle",
		MessagePattern("orders.e2e"),
		GraphMessage(messageIn, {
			bindingId: "message.e2e.in",
			requestId: (host: E2eMessageHost) => host.requestId,
			payload: (host: E2eMessageHost) => host.payload,
		}),
		GraphMessageReply(messageReply, { bindingId: "message.e2e.reply" }),
	);
	applyMethodDecorators(
		E2eMessageController.prototype,
		"pending",
		MessagePattern("orders.e2e.pending"),
		GraphMessage(messagePendingIn, {
			bindingId: "message.e2e.pending.in",
			requestId: (host: E2eMessageHost) => host.requestId,
			payload: (host: E2eMessageHost) => host.payload,
		}),
		GraphMessageReply(messagePendingReply, { bindingId: "message.e2e.pending.reply" }),
	);

	class E2eAppModule {}
	applyClassDecorator(
		Module({
			controllers: [E2eHttpController, E2eMessageController],
			providers: [
				E2eWsGateway,
				provideGraphBoundaryInterceptor({
					host: (context) => {
						const req = context.switchToHttp().getRequest<{
							body?: E2eHttpHost["body"];
							headers?: E2eHttpHost["headers"];
						}>();
						const requestId = req.headers?.["x-request-id"];
						return {
							requestId: Array.isArray(requestId) ? requestId[0] : (requestId ?? "req-http"),
							body: req.body ?? {},
							headers: req.headers,
						};
					},
					requestId: (host: E2eHttpHost) => host.requestId,
				}),
				...provideGraphWsProviders<E2eWsHost>({
					bridge: {
						ack: (host) => host.ack,
						client: (host) => host.client,
					},
				}),
				...provideGraphMessageProviders<E2eMessageHost>(),
			],
		}),
		E2eAppModule,
	);

	const app = await NestFactory.create(E2eAppModule, { logger: false });
	const attachWsAdapter = app.useWebSocketAdapter.bind(app);
	attachWsAdapter(new WsAdapter(app));
	const microservice = app.connectMicroservice({
		transport: Transport.TCP,
		options: { host: "127.0.0.1", port: 0 },
	});
	await app.startAllMicroservices();
	const tcpPort = tcpPortFor(microservice.unwrap());
	await app.listen(0, "127.0.0.1");
	const wsGateway = app.get(E2eWsGateway);
	const messageController = app.get(E2eMessageController, { strict: false });
	const wsBridge = app.get<GraphWsBridge<E2eWsHost>>(GRAPHREFLY_NEST_WS_BRIDGE);
	const messageBridge = app.get<GraphMessageBridge<E2eMessageHost>>(GRAPHREFLY_NEST_MESSAGE_BRIDGE);
	wsGateway.bridge = wsBridge;
	messageController.bridge = messageBridge;

	let closed = false;
	return {
		app,
		url: await app.getUrl(),
		tcpPort,
		wsGateway,
		messageController,
		wsBridge,
		messageBridge,
		httpSeen,
		wsSeen,
		messageSeen,
		graphJson: () => JSON.stringify(g.describe()),
		close: async () => {
			if (closed) return;
			closed = true;
			await app.close();
		},
	};
}

function isWsMessageBody(value: unknown): value is WsMessageBody {
	return value !== null && typeof value === "object" && "requestId" in value && "payload" in value;
}

function tcpPortFor(server: unknown): number {
	const address =
		server !== null && typeof server === "object" && "address" in server
			? (server as { address: () => AddressInfo | string | null }).address()
			: undefined;
	if (address === null || address === undefined || typeof address === "string") {
		throw new Error("Nest TCP live acceptance test could not resolve a random TCP port");
	}
	return address.port;
}

async function openWebSocket(baseUrl: string): Promise<WebSocket> {
	const url = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
	const socket = new WebSocket(url);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), {
			once: true,
		});
	});
	return socket;
}

function nextWebSocketJson(socket: WebSocket): Promise<unknown> {
	return new Promise((resolve, reject) => {
		socket.addEventListener(
			"message",
			(event) => {
				try {
					resolve(JSON.parse(String(event.data)));
				} catch (error) {
					reject(error);
				}
			},
			{ once: true },
		);
	});
}

function applyClassDecorator(decorator: ClassDecorator, target: abstract new () => unknown): void {
	decorator(target);
}

function applyMethodDecorators(
	prototype: object,
	methodKey: string,
	...decorators: MethodDecorator[]
): void {
	const descriptor = Object.getOwnPropertyDescriptor(prototype, methodKey);
	if (descriptor === undefined) throw new Error(`Missing descriptor for ${methodKey}`);
	for (const decorator of decorators) decorator(prototype, methodKey, descriptor);
}
